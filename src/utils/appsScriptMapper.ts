import {
  DRIVE_STAGES,
  type AppsScriptCalendarEventRow,
  type AppsScriptClientRow,
  type AppsScriptDriveEtapaRow,
  type AppsScriptInstallmentRow,
  type AppsScriptPayload,
  type AppsScriptSyncResult,
  type ClientCase,
  type DriveFileItem,
  type DriveStage,
  type Installment,
} from '../types/honorarios.ts';
import {
  isValidDriveFolderUrl,
  normalizeText,
  parseBRLAmountStrict,
  parseFlexibleDateStrict,
  resolveModality,
  resolveStage,
} from './sheetArchitecture.ts';

export type SyncWarningCode =
  | 'CORRUPTED_SHEET_ROW'
  | 'MISSING_DRIVE_FOLDER'
  | 'INVALID_DRIVE_URL'
  | 'MISSING_CALENDAR_EVENT'
  | 'ORPHAN_CALENDAR_EVENT';

export interface RowParseIssue {
  scope: 'cliente' | 'parcela';
  rowId: string;
  clientId: string;
  clientName: string;
  field: string;
  rawValue: string;
  reason: string;
}

export interface ClientSyncWarning {
  code: SyncWarningCode;
  severity: 'warning' | 'info';
  source: 'sheets' | 'drive' | 'calendar';
  message: string;
  installmentId?: string;
  dueDate?: string;
  field?: string;
}

export interface ClientTriangulationHealth {
  clientId: string;
  clientName: string;
  healthy: boolean;
  driveOk: boolean;
  driveUrlValid: boolean;
  calendarOk: boolean;
  pendingInstallmentsCount: number;
  pendingWithCalendarCount: number;
  missingCalendarDueDates: string[];
  corruptedRowCount: number;
  warnings: ClientSyncWarning[];
}

export interface PortfolioHealthReport {
  checkedAt: string;
  ssotAuthority: 'Google Sheets';
  totalClients: number;
  healthyClientsCount: number;
  clientsWithWarningsCount: number;
  missingDriveCount: number;
  missingCalendarEventsCount: number;
  corruptedRowsCount: number;
  parseIssues: RowParseIssue[];
  warningsByClientId: Record<string, ClientSyncWarning[]>;
  healthByClientId: Record<string, ClientTriangulationHealth>;
}

export type EnrichedClientCase = ClientCase & {
  syncWarnings?: ClientSyncWarning[];
  healthCheck?: ClientTriangulationHealth;
};

export type EnrichedAppsScriptSyncResult = Omit<AppsScriptSyncResult, 'clients'> & {
  clients: EnrichedClientCase[];
  parseIssues: RowParseIssue[];
  healthReport: PortfolioHealthReport;
};

interface IndexedDriveMatch {
  etapa: DriveStage;
  rawEtapa: string;
  nomePasta: string;
  urlPasta: string;
  normalizedPasta: string;
  arquivos: DriveFileItem[];
}

function stripFolderDecorators(folderName: string): string {
  return normalizeText(
    folderName
      .replace(/^(?:[a-z]{1,5}\s*[-–_.]?\s*\d{1,5}|\d{1,5})\s*[-–—._|:]\s*/i, '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(
        /\s*[-–—_|/]\s*(div[oó]rcio|pens[aã]o|guarda|alimentos|invent[aá]rio|fam[ií]lia|curatela|interdi[çc][aã]o).*$/i,
        ''
      )
  );
}

function findMatchingDriveEtapa(
  clientName: string,
  indexedDrive: IndexedDriveMatch[]
): IndexedDriveMatch | undefined {
  const normClient = normalizeText(clientName);
  if (!normClient) return undefined;

  // 1. Exact match on full folder name or stripped name
  const exact = indexedDrive.find(
    (d) =>
      d.normalizedPasta === normClient ||
      stripFolderDecorators(d.nomePasta) === normClient
  );
  if (exact) return exact;

  // 2. Partial inclusion (folder contains client name or vice versa, min 4 chars)
  const partial = indexedDrive.find(
    (d) =>
      d.normalizedPasta.length >= 4 &&
      (d.normalizedPasta.includes(normClient) ||
        normClient.includes(d.normalizedPasta))
  );
  if (partial) return partial;

  // 3. Multi-word token overlap (at least 2 matching significant tokens)
  const clientTokens = normClient.split(' ').filter((t) => t.length >= 3);
  if (clientTokens.length >= 2) {
    return indexedDrive.find((d) => {
      const folderTokens = new Set(
        d.normalizedPasta.split(' ').filter((t) => t.length >= 3)
      );
      const matches = clientTokens.filter((t) => folderTokens.has(t));
      return matches.length >= 2;
    });
  }

  return undefined;
}

function parseParcelNumberPair(
  rawParcela: string | number | undefined,
  fallbackIndex: number,
  fallbackTotal: number
): { number: number; total: number } {
  if (typeof rawParcela === 'number' && Number.isFinite(rawParcela)) {
    const num = Math.max(1, Math.round(rawParcela));
    return { number: num, total: Math.max(num, fallbackTotal) };
  }
  const text = String(rawParcela ?? '').trim();
  const slashMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (slashMatch) {
    const num = Number(slashMatch[1]);
    const total = Number(slashMatch[2]);
    return {
      number: Number.isFinite(num) && num > 0 ? num : fallbackIndex,
      total: Number.isFinite(total) && total > 0 ? total : fallbackTotal,
    };
  }
  const singleNumMatch = text.match(/\d+/);
  if (singleNumMatch) {
    const num = Number(singleNumMatch[0]);
    return {
      number: Number.isFinite(num) && num > 0 ? num : fallbackIndex,
      total: Math.max(num || fallbackIndex, fallbackTotal),
    };
  }
  return { number: fallbackIndex, total: fallbackTotal };
}

function isInstallmentPaid(
  row: AppsScriptInstallmentRow,
  expectedAmount: number,
  recebidoAmount: number,
  faltaAmount: number,
  hasExplicitFalta: boolean
): boolean {
  const normSit = normalizeText(String(row.situacao ?? ''));
  const explicitNotPaid =
    normSit.includes('nao pag') ||
    normSit.includes('em aberto') ||
    normSit.includes('pendente') ||
    normSit.includes('atrasad') ||
    normSit.includes('vencer');

  if (
    !explicitNotPaid &&
    (normSit.includes('pag') ||
      normSit.includes('quit') ||
      normSit.includes('liquidad'))
  ) {
    return true;
  }

  if (recebidoAmount > 0 && hasExplicitFalta && faltaAmount <= 0.01) {
    return true;
  }
  if (
    recebidoAmount > 0 &&
    expectedAmount > 0 &&
    recebidoAmount >= expectedAmount - 0.01
  ) {
    return true;
  }
  return false;
}

function eventMatchesClient(
  ev: AppsScriptCalendarEventRow,
  normClient: string,
  firstToken: string,
  cleanCpfDigits?: string
): boolean {
  const haystackRaw = `${ev.titulo ?? ''} ${ev.descricao ?? ''}`;
  const haystack = normalizeText(haystackRaw);
  if (!haystack) return false;
  if (cleanCpfDigits && haystackRaw.replace(/\D/g, '').includes(cleanCpfDigits)) {
    return true;
  }
  if (haystack.includes(normClient)) return true;
  if (firstToken.length >= 4 && haystack.includes(firstToken)) {
    const clientTokens = normClient.split(' ').filter((t) => t.length >= 3);
    if (clientTokens.length <= 1) return true;
    const lastToken = clientTokens[clientTokens.length - 1];
    // Require either last name match or clear billing prefix with first token
    if (haystack.includes(lastToken) || haystack.includes('cobranca')) {
      return true;
    }
  }
  return false;
}

function findMatchingCalendarEventId(
  clientName: string,
  dueDateISO: string,
  events: AppsScriptCalendarEventRow[],
  clientCpf?: string
): string | undefined {
  const normClient = normalizeText(clientName);
  const firstToken = normClient.split(' ')[0] ?? '';
  const cpfDigits = String(clientCpf ?? '').replace(/\D/g, '');
  const cleanCpfDigits = cpfDigits.length === 11 ? cpfDigits : undefined;

  if (!normClient || !Array.isArray(events) || events.length === 0) {
    return undefined;
  }

  const matched = events.find((ev) => {
    const parsedDate = parseFlexibleDateStrict(ev?.inicio);
    if (!parsedDate.ok || parsedDate.iso !== dueDateISO) return false;
    return eventMatchesClient(ev, normClient, firstToken, cleanCpfDigits);
  });

  return matched?.id ? String(matched.id) : undefined;
}

/**
 * Triangulates state across the 3 sources (Google Sheets SSOT -> Drive -> Calendar)
 * and produces non-blocking per-client health checks & warnings.
 */
export function runPortfolioHealthCheck(
  clients: ClientCase[],
  driveEtapas: AppsScriptDriveEtapaRow[] = [],
  calendarEvents: AppsScriptCalendarEventRow[] = [],
  parseIssues: RowParseIssue[] = []
): PortfolioHealthReport {
  const safeClients = Array.isArray(clients) ? clients : [];
  const safeDrive = Array.isArray(driveEtapas) ? driveEtapas : [];
  const safeCalendar = Array.isArray(calendarEvents) ? calendarEvents : [];
  const safeIssues = Array.isArray(parseIssues) ? parseIssues : [];

  const driveUrlsSet = new Set(
    safeDrive
      .map((d) => String(d?.urlPasta ?? '').trim())
      .filter((u) => isValidDriveFolderUrl(u))
  );

  const issuesByClientId = new Map<string, RowParseIssue[]>();
  for (const issue of safeIssues) {
    const list = issuesByClientId.get(issue.clientId) ?? [];
    list.push(issue);
    issuesByClientId.set(issue.clientId, list);
  }

  const warningsByClientId: Record<string, ClientSyncWarning[]> = {};
  const healthByClientId: Record<string, ClientTriangulationHealth> = {};

  let healthyClientsCount = 0;
  let clientsWithWarningsCount = 0;
  let missingDriveCount = 0;
  let missingCalendarEventsCount = 0;

  for (const client of safeClients) {
    const warnings: ClientSyncWarning[] = [];
    const clientIssues = issuesByClientId.get(client.id) ?? [];

    // 1. Surface isolated sheet parsing errors for this client
    for (const issue of clientIssues) {
      warnings.push({
        code: 'CORRUPTED_SHEET_ROW',
        severity: 'warning',
        source: 'sheets',
        field: issue.field,
        message: `Célula corrompida isolada (${issue.field}="${issue.rawValue}"): ${issue.reason}`,
      });
    }

    // 2. Drive check: verify folder URL exists and is a valid Drive folder URL
    const rawUrl = String(client.driveFolderUrl ?? '').trim();
    const driveUrlValid = isValidDriveFolderUrl(rawUrl);
    const hasGenericFallback =
      !rawUrl || rawUrl.endsWith('/my-drive') || rawUrl.endsWith('/my-drive/');

    if (hasGenericFallback) {
      missingDriveCount += 1;
      warnings.push({
        code: 'MISSING_DRIVE_FOLDER',
        severity: 'warning',
        source: 'drive',
        message: `Pasta do cliente "${client.fullName}" não localizada no Google Drive.`,
      });
    } else if (!driveUrlValid) {
      missingDriveCount += 1;
      warnings.push({
        code: 'INVALID_DRIVE_URL',
        severity: 'warning',
        source: 'drive',
        message: `URL da pasta no Google Drive inválida ou inacessível ("${rawUrl}").`,
      });
    } else if (safeDrive.length > 0 && !driveUrlsSet.has(rawUrl)) {
      warnings.push({
        code: 'INVALID_DRIVE_URL',
        severity: 'info',
        source: 'drive',
        message: `URL da pasta do Drive não consta no índice atual de etapas do Drive.`,
      });
    }

    // 3. Calendar check: verify active billing events cover all unpaid/pending installments
    const pendingInstallments = client.installments.filter((i) => !i.paidDate);
    let pendingWithCalendarCount = 0;
    const missingCalendarDueDates: string[] = [];

    for (const inst of pendingInstallments) {
      const matchedEventId =
        inst.calendarEventId ||
        findMatchingCalendarEventId(
          client.fullName,
          inst.dueDate,
          safeCalendar,
          client.cpf
        );
      if (matchedEventId) {
        pendingWithCalendarCount += 1;
      } else {
        missingCalendarEventsCount += 1;
        missingCalendarDueDates.push(inst.dueDate);
        warnings.push({
          code: 'MISSING_CALENDAR_EVENT',
          severity: 'warning',
          source: 'calendar',
          installmentId: inst.id,
          dueDate: inst.dueDate,
          message: `Parcela ${inst.installmentNumber}/${inst.totalInstallments} (${inst.dueDate}) pendente na planilha sem evento correspondente no Google Calendar.`,
        });
      }
    }

    const driveOk = !hasGenericFallback && driveUrlValid;
    const calendarOk = missingCalendarDueDates.length === 0;
    const healthy = warnings.length === 0;

    if (healthy) {
      healthyClientsCount += 1;
    } else {
      clientsWithWarningsCount += 1;
    }

    const health: ClientTriangulationHealth = {
      clientId: client.id,
      clientName: client.fullName,
      healthy,
      driveOk,
      driveUrlValid,
      calendarOk,
      pendingInstallmentsCount: pendingInstallments.length,
      pendingWithCalendarCount,
      missingCalendarDueDates,
      corruptedRowCount: clientIssues.length,
      warnings,
    };

    warningsByClientId[client.id] = warnings;
    healthByClientId[client.id] = health;
  }

  return {
    checkedAt: new Date().toISOString(),
    ssotAuthority: 'Google Sheets',
    totalClients: safeClients.length,
    healthyClientsCount,
    clientsWithWarningsCount,
    missingDriveCount,
    missingCalendarEventsCount,
    corruptedRowsCount: safeIssues.length,
    parseIssues: safeIssues,
    warningsByClientId,
    healthByClientId,
  };
}

export function mapAppsScriptPayload(
  rawJson: unknown,
  _fallbackTodayISO: string = new Date().toISOString().slice(0, 10)
): EnrichedAppsScriptSyncResult {
  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error('Resposta inválida do Web App do Google Apps Script.');
  }

  const payload = rawJson as AppsScriptPayload & { data?: unknown[] };
  const rawClientes: AppsScriptClientRow[] = Array.isArray(payload.clientes)
    ? payload.clientes
    : [];
  const rawParcelas: AppsScriptInstallmentRow[] = Array.isArray(payload.parcelas)
    ? payload.parcelas
    : [];
  const rawDriveEtapas: AppsScriptDriveEtapaRow[] = Array.isArray(
    payload.driveEtapas
  )
    ? payload.driveEtapas
    : [];
  const rawEventosAgenda: AppsScriptCalendarEventRow[] = Array.isArray(
    payload.eventosAgenda
  )
    ? payload.eventosAgenda
    : [];

  // Fallback compatibility if a legacy Apps Script returns a flat array
  if (
    rawClientes.length === 0 &&
    rawParcelas.length === 0 &&
    (Array.isArray(rawJson) || Array.isArray(payload.data))
  ) {
    throw new Error(
      'Formato legado detectado sem as chaves clientes/parcelas/driveEtapas/eventosAgenda.'
    );
  }

  const parseIssues: RowParseIssue[] = [];

  const indexedDrive: IndexedDriveMatch[] = rawDriveEtapas
    .filter((d) => Boolean(d) && String(d.nomePasta ?? '').trim().length > 0)
    .map((d) => {
      const arquivos: DriveFileItem[] = Array.isArray(d.arquivos)
        ? d.arquivos
            .filter(
              (f) =>
                Boolean(f) &&
                String(f.id ?? '').trim() &&
                String(f.nome ?? '').trim()
            )
            .map((f) => ({
              id: String(f.id ?? '').trim(),
              nome: String(f.nome ?? '').trim(),
              mimeType: String(f.mimeType ?? 'application/octet-stream').trim(),
              url:
                String(f.url ?? '').trim() ||
                `https://drive.google.com/file/d/${String(f.id ?? '').trim()}/view`,
              atualizadoEm: f.atualizadoEm
                ? String(f.atualizadoEm).trim()
                : undefined,
            }))
        : [];
      const rawEtapa = String(d.etapa ?? '').trim() || DRIVE_STAGES[0];
      return {
        etapa: resolveStage(d.etapa),
        rawEtapa,
        nomePasta: String(d.nomePasta ?? '').trim(),
        urlPasta:
          String(d.urlPasta ?? '').trim() ||
          'https://drive.google.com/drive/my-drive',
        normalizedPasta: normalizeText(String(d.nomePasta ?? '')),
        arquivos,
      };
    });

  const normalizedDriveEtapas: AppsScriptDriveEtapaRow[] = indexedDrive.map(
    (d) => ({
      etapa: d.rawEtapa,
      nomePasta: d.nomePasta,
      urlPasta: d.urlPasta,
      arquivos: d.arquivos,
    })
  );

  // Group installments by clientId and normalized client name (Sheets SSOT)
  const parcelasByClientId = new Map<string, AppsScriptInstallmentRow[]>();
  const parcelasByClientName = new Map<string, AppsScriptInstallmentRow[]>();

  for (const p of rawParcelas) {
    if (!p || typeof p !== 'object') continue;
    const cid = String(p.idCliente ?? '').trim();
    const cname = normalizeText(String(p.cliente ?? ''));
    if (cid) {
      const list = parcelasByClientId.get(cid) ?? [];
      list.push(p);
      parcelasByClientId.set(cid, list);
    }
    if (cname) {
      const list = parcelasByClientName.get(cname) ?? [];
      list.push(p);
      parcelasByClientName.set(cname, list);
    }
  }

  const consumedParcelas = new Set<AppsScriptInstallmentRow>();
  let matchedDriveCount = 0;

  const buildClientCase = (
    c: AppsScriptClientRow,
    index: number,
    matchedParcelas: AppsScriptInstallmentRow[]
  ): ClientCase => {
    const id = String(c.id ?? `as-cli-${index + 1}`).trim() || `as-cli-${index + 1}`;
    const fullName = String(c.nome ?? 'Cliente').trim() || `Cliente ${index + 1}`;
    const rawCpf = String(c.cpf ?? '').trim();
    const driveMatch = findMatchingDriveEtapa(fullName, indexedDrive);
    if (driveMatch) {
      matchedDriveCount += 1;
    }

    const modality = resolveModality(c.modalidade);
    const regularCountParsed = parseBRLAmountStrict(c.parcelasRegulares);
    if (!regularCountParsed.ok) {
      parseIssues.push({
        scope: 'cliente',
        rowId: id,
        clientId: id,
        clientName: fullName,
        field: 'parcelasRegulares',
        rawValue: regularCountParsed.raw,
        reason: regularCountParsed.error ?? 'Número de parcelas inválido',
      });
    }
    const regularCount = Math.max(0, Math.round(regularCountParsed.value));

    const installments: Installment[] = matchedParcelas
      .map((p, pIdx): Installment | null => {
        consumedParcelas.add(p);
        const rowId = String(p.idParcela ?? `${id}-p${pIdx + 1}`).trim();
        try {
          const previstoParsed = parseBRLAmountStrict(p.previsto);
          const recebidoParsed = parseBRLAmountStrict(p.recebido);
          const faltaParsed = parseBRLAmountStrict(p.faltaReceber);

          if (!previstoParsed.ok) {
            parseIssues.push({
              scope: 'parcela',
              rowId,
              clientId: id,
              clientName: fullName,
              field: 'previsto',
              rawValue: previstoParsed.raw,
              reason: previstoParsed.error ?? 'Valor previsto inválido',
            });
          }
          if (!recebidoParsed.ok) {
            parseIssues.push({
              scope: 'parcela',
              rowId,
              clientId: id,
              clientName: fullName,
              field: 'recebido',
              rawValue: recebidoParsed.raw,
              reason: recebidoParsed.error ?? 'Valor recebido inválido',
            });
          }
          if (!faltaParsed.ok) {
            parseIssues.push({
              scope: 'parcela',
              rowId,
              clientId: id,
              clientName: fullName,
              field: 'faltaReceber',
              rawValue: faltaParsed.raw,
              reason: faltaParsed.error ?? 'Saldo restante inválido',
            });
          }

          const previsto = previstoParsed.ok && previstoParsed.value > 0 ? previstoParsed.value : 0;
          const recebido = recebidoParsed.ok && recebidoParsed.value > 0 ? recebidoParsed.value : 0;
          const falta = faltaParsed.ok && faltaParsed.value > 0 ? faltaParsed.value : 0;
          const amount =
            previsto > 0 ? previsto : recebido > 0 ? recebido : falta;

          const hasExplicitFalta =
            !faltaParsed.isEmpty && faltaParsed.ok;

          const paid = isInstallmentPaid(
            p,
            amount,
            recebido,
            falta,
            hasExplicitFalta
          );

          const vencimentoParsed = parseFlexibleDateStrict(p.vencimento);
          const dataConfirmadaParsed = parseFlexibleDateStrict(p.dataConfirmada);
          const ultimoPagamentoParsed = parseFlexibleDateStrict(p.ultimoPagamento);

          if (!vencimentoParsed.ok && !vencimentoParsed.isEmpty) {
            parseIssues.push({
              scope: 'parcela',
              rowId,
              clientId: id,
              clientName: fullName,
              field: 'vencimento',
              rawValue: vencimentoParsed.raw,
              reason: vencimentoParsed.error ?? 'Data de vencimento inválida',
            });
          }
          if (!dataConfirmadaParsed.ok && !dataConfirmadaParsed.isEmpty) {
            parseIssues.push({
              scope: 'parcela',
              rowId,
              clientId: id,
              clientName: fullName,
              field: 'dataConfirmada',
              rawValue: dataConfirmadaParsed.raw,
              reason: dataConfirmadaParsed.error ?? 'Data confirmada inválida',
            });
          }
          if (!ultimoPagamentoParsed.ok && !ultimoPagamentoParsed.isEmpty) {
            parseIssues.push({
              scope: 'parcela',
              rowId,
              clientId: id,
              clientName: fullName,
              field: 'ultimoPagamento',
              rawValue: ultimoPagamentoParsed.raw,
              reason: ultimoPagamentoParsed.error ?? 'Data de pagamento inválida',
            });
          }

          const dueDate =
            (vencimentoParsed.ok ? vencimentoParsed.iso : undefined) ??
            (dataConfirmadaParsed.ok ? dataConfirmadaParsed.iso : undefined) ??
            (paid && ultimoPagamentoParsed.ok
              ? ultimoPagamentoParsed.iso
              : undefined);

          // Fault isolation: skip corrupted/undated/zero installments without poisoning portfolio totals
          if (!dueDate || !Number.isFinite(amount) || amount <= 0) {
            return null;
          }

          const paidDate = paid
            ? (ultimoPagamentoParsed.ok
                ? ultimoPagamentoParsed.iso
                : undefined) ??
              (dataConfirmadaParsed.ok
                ? dataConfirmadaParsed.iso
                : undefined) ??
              dueDate
            : undefined;

          const pair = parseParcelNumberPair(
            p.parcela,
            pIdx + 1,
            Math.max(regularCount, matchedParcelas.length)
          );

          return {
            id: rowId,
            clientId: id,
            clientName: fullName,
            installmentNumber: pair.number,
            totalInstallments: pair.total,
            amount,
            dueDate,
            paidDate,
            calendarEventId: findMatchingCalendarEventId(
              fullName,
              dueDate,
              rawEventosAgenda,
              rawCpf
            ),
          };
        } catch (err: unknown) {
          parseIssues.push({
            scope: 'parcela',
            rowId,
            clientId: id,
            clientName: fullName,
            field: 'row',
            rawValue: JSON.stringify(p ?? {}),
            reason:
              err instanceof Error
                ? err.message
                : 'Erro inesperado ao processar linha de parcela',
          });
          return null;
        }
      })
      .filter((inst): inst is Installment => inst !== null);

    const maxInstallmentTotal = installments.reduce(
      (max, inst) => Math.max(max, inst.totalInstallments, installments.length),
      Math.max(regularCount, installments.length)
    );
    const normalizedInstallments = installments.map((inst) => ({
      ...inst,
      totalInstallments: Math.max(inst.totalInstallments, maxInstallmentTotal),
    }));

    const installmentsSum =
      Math.round(
        normalizedInstallments.reduce((sum, inst) => sum + inst.amount, 0) * 100
      ) / 100;

    const totalContratadoParsed = parseBRLAmountStrict(c.totalContratado);
    if (!totalContratadoParsed.ok) {
      parseIssues.push({
        scope: 'cliente',
        rowId: id,
        clientId: id,
        clientName: fullName,
        field: 'totalContratado',
        rawValue: totalContratadoParsed.raw,
        reason: totalContratadoParsed.error ?? 'Total contratado inválido',
      });
    }

    const contractedTotal =
      totalContratadoParsed.ok && totalContratadoParsed.value > 0
        ? totalContratadoParsed.value
        : installmentsSum;

    const noteParts: string[] = [];
    const entradaParsed = parseBRLAmountStrict(c.entrada);
    const exitoParsed = parseBRLAmountStrict(c.exitoPercentual);
    const entrada = entradaParsed.ok && entradaParsed.value > 0 ? entradaParsed.value : 0;
    const exitoPct = exitoParsed.ok && exitoParsed.value > 0 ? exitoParsed.value : 0;
    if (entrada > 0) {
      noteParts.push(
        `Entrada: ${new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }).format(entrada)}`
      );
    }
    if (exitoPct > 0) {
      noteParts.push(`Êxito: ${exitoPct}%`);
    }
    if (c.situacao && String(c.situacao).trim()) {
      noteParts.push(`Planilha: ${String(c.situacao).trim()}`);
    }
    const alerts = matchedParcelas
      .map((p) => String(p.alerta ?? '').trim())
      .filter(Boolean);
    if (alerts.length > 0) {
      noteParts.push(`Alerta: ${alerts[0]}`);
    }

    const driveStage: DriveStage = driveMatch
      ? driveMatch.etapa
      : String(c.situacao ?? '').toLowerCase().includes('protocol')
        ? 'Protocolados / Processo Ativo'
        : DRIVE_STAGES[0];

    const driveFolderUrl =
      driveMatch?.urlPasta ?? 'https://drive.google.com/drive/my-drive';

    const rawPhone = String(c.whatsapp ?? c.telefone ?? '').trim();

    return {
      id,
      fullName,
      cpf: rawCpf || undefined,
      phone: rawPhone || '11999999999',
      caseType:
        String(c.acao ?? '').trim() ||
        (rawCpf
          ? `Direito de Família · CPF ${rawCpf}`
          : 'Direito de Família'),
      driveStage,
      rawDriveStage: driveMatch?.rawEtapa,
      driveFolderUrl,
      driveFiles: driveMatch?.arquivos ?? [],
      modality,
      contractedTotal,
      notes: noteParts.length > 0 ? noteParts.join(' · ') : undefined,
      installments: normalizedInstallments,
    };
  };

  const baseClients: ClientCase[] = [];
  rawClientes.forEach((c, idx) => {
    if (!c || typeof c !== 'object') return;
    try {
      const cid = String(c.id ?? '').trim();
      const cname = normalizeText(String(c.nome ?? ''));
      const byId = cid ? parcelasByClientId.get(cid) ?? [] : [];
      const byName = cname ? parcelasByClientName.get(cname) ?? [] : [];
      const seen = new Set<AppsScriptInstallmentRow>();
      const combined: AppsScriptInstallmentRow[] = [];
      for (const p of [...byId, ...byName]) {
        if (!seen.has(p)) {
          seen.add(p);
          combined.push(p);
        }
      }
      baseClients.push(buildClientCase(c, idx, combined));
    } catch (err: unknown) {
      parseIssues.push({
        scope: 'cliente',
        rowId: String(c.id ?? `row-${idx + 1}`),
        clientId: String(c.id ?? `row-${idx + 1}`),
        clientName: String(c.nome ?? 'Cliente corrompido'),
        field: 'row',
        rawValue: JSON.stringify(c),
        reason:
          err instanceof Error
            ? err.message
            : 'Erro inesperado ao mapear cliente',
      });
    }
  });

  // Handle orphan installments whose client wasn't listed in `clientes`
  const orphanGroups = new Map<string, AppsScriptInstallmentRow[]>();
  for (const p of rawParcelas) {
    if (!p || typeof p !== 'object' || consumedParcelas.has(p)) continue;
    const key =
      String(p.idCliente ?? '').trim() ||
      normalizeText(String(p.cliente ?? '')) ||
      'sem-cliente';
    const list = orphanGroups.get(key) ?? [];
    list.push(p);
    orphanGroups.set(key, list);
  }

  let orphanIdx = baseClients.length;
  for (const [, group] of orphanGroups.entries()) {
    const first = group[0];
    baseClients.push(
      buildClientCase(
        {
          id: first.idCliente ?? `as-orphan-${orphanIdx + 1}`,
          nome: first.cliente ?? 'Cliente da Planilha',
          modalidade: 'Parcelado',
        },
        orphanIdx,
        group
      )
    );
    orphanIdx += 1;
  }

  // Triangulation Health Check (Sheets SSOT <-> Drive <-> Calendar)
  const healthReport = runPortfolioHealthCheck(
    baseClients,
    normalizedDriveEtapas,
    rawEventosAgenda,
    parseIssues
  );

  const clients: EnrichedClientCase[] = baseClients.map((client) => ({
    ...client,
    syncWarnings: healthReport.warningsByClientId[client.id] ?? [],
    healthCheck: healthReport.healthByClientId[client.id],
  }));

  const totalParcelasMapped = clients.reduce(
    (sum, c) => sum + c.installments.length,
    0
  );
  const totalDriveFilesMapped = clients.reduce(
    (sum, c) => sum + (c.driveFiles?.length ?? 0),
    0
  );

  return {
    clients,
    calendarEvents: rawEventosAgenda,
    driveEtapas: normalizedDriveEtapas,
    parseIssues,
    healthReport,
    summary: {
      syncedAt: new Date().toISOString(),
      clientesCount: clients.length,
      parcelasCount: totalParcelasMapped,
      driveEtapasCount: rawDriveEtapas.length,
      matchedDriveCount,
      driveFilesCount: totalDriveFilesMapped,
      eventosAgendaCount: rawEventosAgenda.length,
    },
  };
}
