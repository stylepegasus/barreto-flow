import {
  AppsScriptCalendarEventRow,
  AppsScriptClientRow,
  AppsScriptDriveEtapaRow,
  AppsScriptInstallmentRow,
  AppsScriptPayload,
  AppsScriptSyncResult,
  ClientCase,
  DRIVE_STAGES,
  DriveFileItem,
  DriveStage,
  Installment,
} from '../types/honorarios';
import {
  normalizeText,
  parseBRLAmount,
  parseFlexibleDateISO,
  resolveModality,
  resolveStage,
} from './sheetArchitecture';

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
      .replace(/^\d+\s*[-–._]\s*/, '')
      .replace(/\s*[-–]\s*(divorcio|pensao|guarda|alimentos|inventario|familia).*$/i, '')
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
  expectedAmount: number
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

  const recebido = parseBRLAmount(row.recebido);
  const falta = parseBRLAmount(row.faltaReceber);
  const hasExplicitFalta =
    row.faltaReceber !== undefined &&
    row.faltaReceber !== null &&
    String(row.faltaReceber).trim() !== '';

  if (recebido > 0 && hasExplicitFalta && falta <= 0.01) {
    return true;
  }
  if (recebido > 0 && expectedAmount > 0 && recebido >= expectedAmount - 0.01) {
    return true;
  }
  return false;
}

function findMatchingCalendarEventId(
  clientName: string,
  dueDateISO: string,
  events: AppsScriptCalendarEventRow[]
): string | undefined {
  const normClient = normalizeText(clientName);
  const firstToken = normClient.split(' ')[0] ?? '';
  if (!normClient || events.length === 0) return undefined;

  const matched = events.find((ev) => {
    const eventDate = parseFlexibleDateISO(ev.inicio);
    if (eventDate !== dueDateISO) return false;
    const haystack = normalizeText(`${ev.titulo ?? ''} ${ev.descricao ?? ''}`);
    return (
      haystack.includes(normClient) ||
      (firstToken.length >= 4 && haystack.includes(firstToken))
    );
  });

  return matched?.id ? String(matched.id) : undefined;
}

export function mapAppsScriptPayload(
  rawJson: unknown,
  fallbackTodayISO: string = new Date().toISOString().slice(0, 10)
): AppsScriptSyncResult {
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

  const indexedDrive: IndexedDriveMatch[] = rawDriveEtapas
    .filter((d) => String(d.nomePasta ?? '').trim().length > 0)
    .map((d) => {
      const arquivos: DriveFileItem[] = Array.isArray(d.arquivos)
        ? d.arquivos
            .filter((f) => String(f?.id ?? '').trim() && String(f?.nome ?? '').trim())
            .map((f) => ({
              id: String(f.id ?? '').trim(),
              nome: String(f.nome ?? '').trim(),
              mimeType: String(f.mimeType ?? 'application/octet-stream').trim(),
              url:
                String(f.url ?? '').trim() ||
                `https://drive.google.com/file/d/${String(f.id ?? '').trim()}/view`,
              atualizadoEm: f.atualizadoEm ? String(f.atualizadoEm).trim() : undefined,
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

  // Group installments by clientId and normalized client name
  const parcelasByClientId = new Map<string, AppsScriptInstallmentRow[]>();
  const parcelasByClientName = new Map<string, AppsScriptInstallmentRow[]>();

  for (const p of rawParcelas) {
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
    const id = String(c.id ?? `as-cli-${index + 1}`).trim();
    const fullName = String(c.nome ?? 'Cliente').trim() || `Cliente ${index + 1}`;
    const driveMatch = findMatchingDriveEtapa(fullName, indexedDrive);
    if (driveMatch) {
      matchedDriveCount += 1;
    }

    const modality = resolveModality(c.modalidade);
    const regularCount = Math.max(
      0,
      Math.round(parseBRLAmount(c.parcelasRegulares))
    );

    const installments: Installment[] = matchedParcelas
      .map((p, pIdx): Installment | null => {
        consumedParcelas.add(p);
        const previsto = parseBRLAmount(p.previsto);
        const recebido = parseBRLAmount(p.recebido);
        const falta = parseBRLAmount(p.faltaReceber);
        const amount =
          previsto > 0 ? previsto : recebido > 0 ? recebido : falta;

        const paid = isInstallmentPaid(p, amount);
        const dueDate =
          parseFlexibleDateISO(p.vencimento) ??
          parseFlexibleDateISO(p.dataConfirmada) ??
          (paid ? parseFlexibleDateISO(p.ultimoPagamento) : undefined);

        if (!dueDate || amount <= 0) {
          return null;
        }

        const paidDate = paid
          ? parseFlexibleDateISO(p.ultimoPagamento) ??
            parseFlexibleDateISO(p.dataConfirmada) ??
            dueDate
          : undefined;

        const pair = parseParcelNumberPair(
          p.parcela,
          pIdx + 1,
          Math.max(regularCount, matchedParcelas.length)
        );

        return {
          id: String(p.idParcela ?? `${id}-p${pIdx + 1}`),
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
            rawEventosAgenda
          ),
        };
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

    const installmentsSum = normalizedInstallments.reduce(
      (sum, inst) => sum + inst.amount,
      0
    );
    const contractedTotal =
      parseBRLAmount(c.totalContratado) || installmentsSum;

    const noteParts: string[] = [];
    const entrada = parseBRLAmount(c.entrada);
    const exitoPct = parseBRLAmount(c.exitoPercentual);
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
      phone: rawPhone || '11999999999',
      caseType:
        String(c.acao ?? '').trim() ||
        (c.cpf && String(c.cpf).trim()
          ? `Direito de Família · CPF ${String(c.cpf).trim()}`
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

  const clients: ClientCase[] = rawClientes.map((c, idx) => {
    const cid = String(c.id ?? '').trim();
    const cname = normalizeText(String(c.nome ?? ''));
    const byId = cid ? parcelasByClientId.get(cid) ?? [] : [];
    const byName = cname ? parcelasByClientName.get(cname) ?? [] : [];
    // Deduplicate combined matches preserving order
    const seen = new Set<AppsScriptInstallmentRow>();
    const combined: AppsScriptInstallmentRow[] = [];
    for (const p of [...byId, ...byName]) {
      if (!seen.has(p)) {
        seen.add(p);
        combined.push(p);
      }
    }
    return buildClientCase(c, idx, combined);
  });

  // Handle orphan installments whose client wasn't listed in `clientes`
  const orphanGroups = new Map<string, AppsScriptInstallmentRow[]>();
  for (const p of rawParcelas) {
    if (consumedParcelas.has(p)) continue;
    const key =
      String(p.idCliente ?? '').trim() ||
      normalizeText(String(p.cliente ?? '')) ||
      'sem-cliente';
    const list = orphanGroups.get(key) ?? [];
    list.push(p);
    orphanGroups.set(key, list);
  }

  let orphanIdx = clients.length;
  for (const [, group] of orphanGroups.entries()) {
    const first = group[0];
    clients.push(
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
