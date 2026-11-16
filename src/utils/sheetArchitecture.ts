import {
  ClientCase,
  DRIVE_STAGES,
  DriveArchitectureSummary,
  DriveFolderNode,
  DriveStage,
  Installment,
  PaymentModality,
  SheetTabArchitecture,
  WorkspaceArchitectureSnapshot,
} from '../types/honorarios';

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveStage(rawStage: string | undefined): DriveStage {
  const norm = normalizeText(rawStage ?? '');
  if (!norm) return DRIVE_STAGES[0];
  if (norm.includes('luis') || norm.startsWith('01')) return '01- Etapa Luis';
  if (norm.includes('carlos') || norm.startsWith('02')) return '02- Etapa Carlos';
  if (norm.includes('gilmar') || norm.startsWith('03')) return '03- Etapa Gilmar';
  if (norm.includes('emenda') || norm.startsWith('04')) return '04- Emendas';
  if (
    norm.includes('protocol') ||
    norm.includes('ativo') ||
    norm.startsWith('05')
  ) {
    return 'Protocolados / Processo Ativo';
  }
  return DRIVE_STAGES[0];
}

function matchStageFolder(folderName: string): DriveStage | null {
  const norm = normalizeText(folderName);
  for (const stage of DRIVE_STAGES) {
    if (
      norm.includes(normalizeText(stage)) ||
      (stage.includes('Luis') && norm.includes('luis')) ||
      (stage.includes('Carlos') && norm.includes('carlos')) ||
      (stage.includes('Gilmar') && norm.includes('gilmar')) ||
      (stage.includes('Emendas') && norm.includes('emenda')) ||
      (stage.includes('Protocolados') && norm.includes('protocol'))
    ) {
      return stage;
    }
  }
  return null;
}

export function resolveModality(rawModality: string | undefined): PaymentModality {
  const norm = normalizeText(rawModality ?? '');
  if (norm.includes('vista') || norm.includes('a vista')) return 'À vista';
  if (norm.includes('exito') || norm.includes('30%')) return 'Êxito 30%';
  return 'Parcelado';
}

export function parseBRLAmount(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : 0;
  }
  const text = String(raw ?? '').replace(/[R$\s]/g, '').trim();
  if (!text) return 0;

  // If comma exists (Brazilian format: 1.500,00 or 1500,50)
  if (text.includes(',')) {
    const cleaned = text.replace(/\./g, '').replace(',', '.');
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : 0;
  }

  // If dot exists without comma: 1500.50 -> decimal; 1.500 -> thousands separator
  if (text.includes('.')) {
    if (/^\d+\.\d{1,2}$/.test(text)) {
      const num = Number(text);
      return Number.isFinite(num) ? num : 0;
    }
    const cleaned = text.replace(/\./g, '');
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : 0;
  }

  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

export function parseFlexibleDateISO(raw: unknown): string | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 80000) {
    // Google Sheets serial date (days since 1899-12-30)
    const utcMs = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    return new Date(utcMs).toISOString().slice(0, 10);
  }

  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (isoMatch) return isoMatch[1];

  const brMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (brMatch) {
    const [, d, m, yRaw] = brMatch;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    const monthNum = Number(m);
    const dayNum = Number(d);
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }
  return undefined;
}

export function analyzeDriveArchitecture(
  folders: DriveFolderNode[],
  preferredNames: string[] = ['Clientes Tráfego Pago', 'Cliente Tráfego Pago']
): DriveArchitectureSummary {
  const normalizedPrefs = preferredNames.map(normalizeText);

  // Prefer exact match, then partial match on Clientes/Cliente Tráfego Pago
  const rootFolder =
    folders.find((f) => normalizedPrefs.includes(normalizeText(f.name))) ??
    folders.find((f) => {
      const n = normalizeText(f.name);
      return (
        n.includes('clientes trafego pago') ||
        n.includes('cliente trafego pago') ||
        (n.includes('trafego pago') && n.includes('cliente'))
      );
    }) ??
    null;

  const folderUrl = (f: DriveFolderNode) =>
    f.webViewLink ?? `https://drive.google.com/drive/folders/${f.id}`;

  const stageFoldersMap = new Map<
    string,
    { stage: DriveStage; folder: DriveFolderNode; clientCount: number }
  >();
  const clientFolderLinks: Record<string, string> = {};
  const clientStageByName: Record<string, DriveStage> = {};
  const sampleClientFolderNames: string[] = [];
  let directClientFoldersCount = 0;
  let totalClientFoldersCount = 0;

  if (rootFolder) {
    const directChildren = folders.filter((f) =>
      f.parents?.includes(rootFolder.id)
    );

    for (const child of directChildren) {
      const matchedStage = matchStageFolder(child.name);
      if (matchedStage) {
        stageFoldersMap.set(child.id, {
          stage: matchedStage,
          folder: child,
          clientCount: 0,
        });
      } else {
        // Direct client folder inside "Clientes Tráfego Pago"
        const key = normalizeText(child.name);
        if (key) {
          clientFolderLinks[key] = folderUrl(child);
          directClientFoldersCount += 1;
          totalClientFoldersCount += 1;
          if (sampleClientFolderNames.length < 15) {
            sampleClientFolderNames.push(child.name);
          }
        }
      }
    }

    // Grandchildren inside stage folders
    for (const folder of folders) {
      const parentStageId = folder.parents?.find((p) => stageFoldersMap.has(p));
      if (!parentStageId) continue;

      const stageEntry = stageFoldersMap.get(parentStageId)!;
      stageEntry.clientCount += 1;
      totalClientFoldersCount += 1;

      const key = normalizeText(folder.name);
      if (key) {
        clientFolderLinks[key] = folderUrl(folder);
        clientStageByName[key] = stageEntry.stage;
        if (sampleClientFolderNames.length < 15) {
          sampleClientFolderNames.push(folder.name);
        }
      }
    }
  } else {
    // Fallback if root wasn't returned (e.g. user shared only stage folders directly)
    for (const folder of folders) {
      const matchedStage = matchStageFolder(folder.name);
      if (matchedStage) {
        stageFoldersMap.set(folder.id, {
          stage: matchedStage,
          folder,
          clientCount: 0,
        });
      }
    }
    for (const folder of folders) {
      const parentStageId = folder.parents?.find((p) => stageFoldersMap.has(p));
      if (!parentStageId) continue;
      const stageEntry = stageFoldersMap.get(parentStageId)!;
      stageEntry.clientCount += 1;
      totalClientFoldersCount += 1;
      const key = normalizeText(folder.name);
      if (key) {
        clientFolderLinks[key] = folderUrl(folder);
        clientStageByName[key] = stageEntry.stage;
        if (sampleClientFolderNames.length < 15) {
          sampleClientFolderNames.push(folder.name);
        }
      }
    }
  }

  const stageFolders = Array.from(stageFoldersMap.values())
    .sort(
      (a, b) =>
        DRIVE_STAGES.indexOf(a.stage) - DRIVE_STAGES.indexOf(b.stage)
    )
    .map((entry) => ({
      stage: entry.stage,
      folderName: entry.folder.name,
      folderUrl: folderUrl(entry.folder),
      clientCount: entry.clientCount,
    }));

  return {
    rootFolderId: rootFolder?.id ?? null,
    rootFolderName: rootFolder?.name ?? null,
    rootFolderUrl: rootFolder ? folderUrl(rootFolder) : null,
    stageFolders,
    directClientFoldersCount,
    totalClientFoldersCount,
    sampleClientFolderNames,
    clientFolderLinks,
    clientStageByName,
  };
}

const HEADER_KEYWORDS = [
  'cliente',
  'nome',
  'telefone',
  'whatsapp',
  'celular',
  'contato',
  'acao',
  'assunto',
  'caso',
  'processo',
  'etapa',
  'pasta',
  'drive',
  'modalidade',
  'forma',
  'pagamento',
  'valor',
  'honorario',
  'parcela',
  'vencimento',
  'data',
  'status',
  'situacao',
  'quitacao',
  'pago',
  'observacao',
  'obs',
];

export function detectHeaderRowIndex(rows: unknown[][]): number {
  if (rows.length === 0) return 0;
  const maxScan = Math.min(rows.length, 8);
  let bestIdx = 0;
  let bestScore = -1;

  for (let r = 0; r < maxScan; r++) {
    const row = rows[r] ?? [];
    const cells = row
      .map((c) => normalizeText(String(c ?? '')))
      .filter(Boolean);
    if (cells.length < 2) continue;

    let keywordHits = 0;
    for (const cell of cells) {
      if (HEADER_KEYWORDS.some((kw) => cell.includes(kw))) {
        keywordHits += 1;
      }
    }

    const score = keywordHits * 10 + cells.length;
    if (keywordHits > 0 && score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }

  return bestIdx;
}

interface ColumnIndices {
  idxName: number;
  idxPhone: number;
  idxCase: number;
  idxStage: number;
  idxModality: number;
  idxAmount: number;
  idxParcelNum: number;
  idxDueDate: number;
  idxPaidDate: number;
  idxDriveUrl: number;
}

function detectColumns(rawHeaders: string[]): ColumnIndices {
  const normHeaders = rawHeaders.map((h) => normalizeText(h));
  const findCol = (candidates: string[], exclude: number[] = []): number =>
    normHeaders.findIndex(
      (h, idx) =>
        !exclude.includes(idx) &&
        h.length > 0 &&
        candidates.some((c) => h.includes(c))
    );

  const idxName = findCol(['cliente', 'nome completo', 'nome']);
  const idxPhone = findCol(['whatsapp', 'telefone', 'celular', 'fone', 'contato']);
  const idxCase = findCol(['acao', 'tipo de acao', 'assunto', 'demanda', 'caso', 'processo']);
  const idxStage = findCol(['etapa', 'fase', 'pasta drive', 'pasta']);
  const idxModality = findCol(['modalidade', 'forma', 'tipo pagamento', 'plano']);
  const idxAmount = findCol(
    ['valor parcela', 'valor da parcela', 'valor', 'honorario', 'total'],
    []
  );
  const idxParcelNum = findCol(['parcela', 'num parcela', 'numero', 'qtd'], [idxAmount]);
  const idxDueDate = findCol(['vencimento', 'data venc', 'data cobranca', 'dia venc', 'data']);
  const idxPaidDate = findCol(
    ['quitacao', 'pago em', 'data pagamento', 'pagamento em', 'status', 'situacao'],
    [idxDueDate, idxModality]
  );
  const idxDriveUrl = findCol(['link drive', 'url drive', 'link pasta', 'drive', 'link']);

  return {
    idxName,
    idxPhone,
    idxCase,
    idxStage,
    idxModality,
    idxAmount,
    idxParcelNum,
    idxDueDate,
    idxPaidDate,
    idxDriveUrl,
  };
}

export function inspectTabArchitecture(
  title: string,
  sheetId: number,
  rows: unknown[][]
): SheetTabArchitecture {
  const headerIdx = detectHeaderRowIndex(rows);
  const rawHeaderRow = (rows[headerIdx] ?? []).map((cell) =>
    String(cell ?? '').trim()
  );
  // Trim trailing empty header cells
  let lastNonEmpty = rawHeaderRow.length - 1;
  while (lastNonEmpty >= 0 && !rawHeaderRow[lastNonEmpty]) {
    lastNonEmpty -= 1;
  }
  const headers = rawHeaderRow.slice(0, lastNonEmpty + 1);
  const cols = detectColumns(headers);

  const dataRows = rows.slice(headerIdx + 1).filter((row) =>
    Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== '')
  );

  const labelAt = (idx: number) =>
    idx >= 0 && headers[idx] ? headers[idx] : undefined;

  return {
    title,
    sheetId,
    headerRowNumber: headerIdx + 1,
    headers,
    totalRows: rows.length,
    dataRowsCount: dataRows.length,
    recognizedColumns: {
      clientName: labelAt(cols.idxName),
      phone: labelAt(cols.idxPhone),
      caseType: labelAt(cols.idxCase),
      driveStage: labelAt(cols.idxStage),
      modality: labelAt(cols.idxModality),
      amount: labelAt(cols.idxAmount),
      installmentNumber: labelAt(cols.idxParcelNum),
      dueDate: labelAt(cols.idxDueDate),
      paidDateOrStatus: labelAt(cols.idxPaidDate),
      driveUrl: labelAt(cols.idxDriveUrl),
    },
  };
}

export function chooseBestClientsTab(tabs: SheetTabArchitecture[]): SheetTabArchitecture | null {
  if (tabs.length === 0) return null;
  let best = tabs[0];
  let bestScore = -1;

  for (const tab of tabs) {
    const rec = tab.recognizedColumns;
    let score = 0;
    if (rec.clientName) score += 30;
    if (rec.amount) score += 20;
    if (rec.dueDate) score += 20;
    if (rec.paidDateOrStatus) score += 10;
    if (rec.installmentNumber) score += 10;
    if (rec.driveStage) score += 5;
    if (tab.dataRowsCount > 0) score += Math.min(tab.dataRowsCount, 25);

    const normTitle = normalizeText(tab.title);
    if (normTitle.includes('honorario') || normTitle.includes('cliente') || normTitle.includes('parcela')) {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = tab;
    }
  }

  return best;
}

function findClientInDrive(
  clientName: string,
  driveSummary?: DriveArchitectureSummary
): { folderUrl?: string; stage?: DriveStage } {
  if (!driveSummary) return {};
  const key = normalizeText(clientName);
  if (!key) return {};

  if (driveSummary.clientFolderLinks[key] || driveSummary.clientStageByName[key]) {
    return {
      folderUrl: driveSummary.clientFolderLinks[key],
      stage: driveSummary.clientStageByName[key],
    };
  }

  // Fuzzy match if Drive folder has prefix or suffix (e.g. "01 - Maria Silva - Divórcio")
  const matchingKey = Object.keys(driveSummary.clientFolderLinks).find(
    (folderKey) =>
      folderKey.length >= 4 &&
      (folderKey.includes(key) || key.includes(folderKey))
  );
  if (matchingKey) {
    return {
      folderUrl: driveSummary.clientFolderLinks[matchingKey],
      stage: driveSummary.clientStageByName[matchingKey],
    };
  }

  return {};
}

export function parseSheetTabToClients(
  rows: unknown[][],
  driveSummary?: DriveArchitectureSummary,
  fallbackTodayISO: string = new Date().toISOString().slice(0, 10)
): ClientCase[] {
  if (rows.length < 2) return [];

  const headerIdx = detectHeaderRowIndex(rows);
  const rawHeaders = (rows[headerIdx] ?? []).map((h) => String(h ?? '').trim());
  const cols = detectColumns(rawHeaders);

  const clientMap = new Map<string, ClientCase>();
  const dataRows = rows.slice(headerIdx + 1);

  dataRows.forEach((row, offset) => {
    if (!Array.isArray(row)) return;
    const sheetRowNumber = headerIdx + 2 + offset;
    const nameCol = cols.idxName >= 0 ? cols.idxName : 0;
    const rawName = String(row[nameCol] ?? '').trim();

    // Skip empty or obvious summary/total lines
    if (!rawName) return;
    const clientKey = normalizeText(rawName);
    if (
      clientKey === 'total' ||
      clientKey === 'totais' ||
      clientKey.startsWith('total ')
    ) {
      return;
    }

    const amount = parseBRLAmount(
      row[cols.idxAmount >= 0 ? cols.idxAmount : 3]
    );
    const dueDate = parseFlexibleDateISO(
      row[cols.idxDueDate >= 0 ? cols.idxDueDate : 4]
    );

    const paidCol = cols.idxPaidDate >= 0 ? cols.idxPaidDate : 5;
    const rawPaidOrStatus = String(row[paidCol] ?? '').trim();
    const normPaidStatus = normalizeText(rawPaidOrStatus);
    const isMarkedPaid =
      normPaidStatus.includes('pag') ||
      normPaidStatus.includes('quit') ||
      normPaidStatus === 'sim' ||
      normPaidStatus === 'ok' ||
      normPaidStatus.includes('recebid');
    const parsedPaidDate =
      parseFlexibleDateISO(rawPaidOrStatus) ??
      (isMarkedPaid ? dueDate ?? fallbackTodayISO : undefined);

    const parcelText = String(
      cols.idxParcelNum >= 0 ? row[cols.idxParcelNum] ?? '' : ''
    ).trim();
    const parcelMatch = parcelText.match(/(\d+)\s*\/\s*(\d+)/);

    const driveMatch = findClientInDrive(rawName, driveSummary);

    let existing = clientMap.get(clientKey);
    if (!existing) {
      const explicitStage =
        cols.idxStage >= 0 ? String(row[cols.idxStage] ?? '').trim() : '';
      const stage = explicitStage
        ? resolveStage(explicitStage)
        : driveMatch.stage ?? DRIVE_STAGES[0];
      const modality = resolveModality(
        cols.idxModality >= 0 ? String(row[cols.idxModality] ?? '') : ''
      );
      const explicitDriveUrl =
        cols.idxDriveUrl >= 0 ? String(row[cols.idxDriveUrl] ?? '').trim() : '';
      const driveUrl =
        explicitDriveUrl ||
        driveMatch.folderUrl ||
        driveSummary?.rootFolderUrl ||
        'https://drive.google.com/drive/my-drive';

      const rawPhone =
        cols.idxPhone >= 0 ? String(row[cols.idxPhone] ?? '').trim() : '';
      const rawCase =
        cols.idxCase >= 0 ? String(row[cols.idxCase] ?? '').trim() : '';

      existing = {
        id: `gs-${sheetRowNumber}`,
        fullName: rawName,
        phone: rawPhone || '11999999999',
        caseType: rawCase || 'Direito de Família',
        driveStage: stage,
        driveFolderUrl: driveUrl,
        modality,
        contractedTotal: amount,
        installments: [],
      };
      clientMap.set(clientKey, existing);
    } else if (amount > 0) {
      existing.contractedTotal += amount;
    }

    if (dueDate && amount > 0) {
      const inst: Installment = {
        id: `gs-row-${sheetRowNumber}`,
        clientId: existing.id,
        clientName: existing.fullName,
        installmentNumber: parcelMatch
          ? Number(parcelMatch[1])
          : existing.installments.length + 1,
        totalInstallments: parcelMatch
          ? Number(parcelMatch[2])
          : existing.installments.length + 1,
        amount,
        dueDate,
        paidDate: parsedPaidDate,
        sheetRowNumber,
      };
      existing.installments.push(inst);
    }
  });

  return Array.from(clientMap.values()).map((client) => {
    const count = client.installments.length;
    return {
      ...client,
      installments: client.installments.map((inst, i) => ({
        ...inst,
        installmentNumber: inst.installmentNumber || i + 1,
        totalInstallments: Math.max(inst.totalInstallments, count),
      })),
    };
  });
}

export function formatArchitectureReport(
  snapshot: WorkspaceArchitectureSnapshot
): string {
  const lines: string[] = [
    `RELATÓRIO DE ARQUITETURA (SOMENTE LEITURA)`,
    `Planilha: ${snapshot.spreadsheetTitle}`,
    `Aba carregada no painel: ${snapshot.activeTabTitle}`,
    `Clientes lidos: ${snapshot.parsedClientsCount} | Parcelas lidas: ${snapshot.parsedInstallmentsCount}`,
    ``,
    `ABAS DA PLANILHA (${snapshot.tabs.length}):`,
  ];

  for (const tab of snapshot.tabs) {
    lines.push(
      `- Aba "${tab.title}": cabeçalho na linha ${tab.headerRowNumber}, ${tab.dataRowsCount} linhas preenchidas`
    );
    lines.push(
      `  Colunas: ${tab.headers.length > 0 ? tab.headers.join(' | ') : '(nenhuma coluna identificada)'}`
    );
  }

  lines.push(``);
  lines.push(
    `GOOGLE DRIVE (${snapshot.drive.rootFolderName ?? 'Pasta não localizada'}):`
  );
  lines.push(
    `- Pastas de clientes encontradas: ${snapshot.drive.totalClientFoldersCount}`
  );
  if (snapshot.drive.stageFolders.length > 0) {
    for (const sf of snapshot.drive.stageFolders) {
      lines.push(`  • ${sf.folderName} -> ${sf.stage} (${sf.clientCount} pastas)`);
    }
  }
  if (snapshot.drive.directClientFoldersCount > 0) {
    lines.push(
      `  • Pastas de clientes diretamente na raiz: ${snapshot.drive.directClientFoldersCount}`
    );
  }

  return lines.join('\n');
}
