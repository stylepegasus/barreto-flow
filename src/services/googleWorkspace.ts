import {
  AppsScriptSyncResult,
  ClientCase,
  DriveArchitectureSummary,
  DriveFileContentResponse,
  DriveFolderNode,
  DriveStage,
  Installment,
  SheetTabArchitecture,
} from '../types/honorarios';
import {
  analyzeDriveArchitecture,
  chooseBestClientsTab,
  inspectTabArchitecture,
  normalizeText,
  parseBRLAmount,
  parseFlexibleDateISO,
  parseSheetTabToClients,
  resolveModality,
  resolveStage,
} from '../utils/sheetArchitecture';
import { mapAppsScriptPayload } from '../utils/appsScriptMapper';

export const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxz9gSeBsBVBAWNbLZOn4S4NSWQop7sk7FokMc_0bFzDqdLxRzGlmkDYAe1fFA5ruM2wA/exec';

const APPS_SCRIPT_SYNC_TIMEOUT_MS = 75_000;

export interface WorkspaceDiscoveryResult {
  spreadsheetId: string | null;
  spreadsheetTitle: string | null;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  stageFolderLinks: Partial<Record<DriveStage, string>>;
  clientFolderLinks: Record<string, string>;
  driveSummary: DriveArchitectureSummary;
}

export interface SheetInspectionAndLoadResult {
  spreadsheetTitle: string;
  activeTabTitle: string;
  tabs: SheetTabArchitecture[];
  tabRowsByTitle: Record<string, unknown[][]>;
  clients: ClientCase[];
}

async function listAllDriveFolders(
  accessToken: string
): Promise<DriveFolderNode[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const folderQuery = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and trashed=false`
  );

  const collected: DriveFolderNode[] = [];
  let pageToken: string | undefined = undefined;
  let pageCount = 0;

  do {
    const pageParam: string = pageToken
      ? `&pageToken=${encodeURIComponent(pageToken)}`
      : '';
    const res: Response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=nextPageToken,files(id,name,webViewLink,parents)&pageSize=200${pageParam}`,
      { headers }
    );
    if (!res.ok) {
      throw new Error('Não foi possível consultar pastas no Google Drive.');
    }
    const json: { files?: DriveFolderNode[]; nextPageToken?: string } =
      await res.json();
    if (Array.isArray(json.files)) {
      collected.push(...json.files);
    }
    pageToken = json.nextPageToken;
    pageCount += 1;
  } while (pageToken && pageCount < 8);

  return collected;
}

export async function discoverBarretoWorkspace(
  accessToken: string,
  preferredSpreadsheetName = 'Barreto — Honorários (Ads Família)',
  preferredDriveRootName = 'Clientes Tráfego Pago'
): Promise<WorkspaceDiscoveryResult> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // 1. Read-Only search for Spreadsheet in Drive
  const sheetQuery = encodeURIComponent(
    `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
  );
  const sheetRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${sheetQuery}&fields=files(id,name,webViewLink)&pageSize=50`,
    { headers }
  );
  if (!sheetRes.ok) {
    throw new Error('Não foi possível consultar planilhas no Google Drive.');
  }
  const sheetJson = await sheetRes.json();
  const sheetFiles: Array<{ id: string; name: string }> = sheetJson.files ?? [];
  const matchedSheet =
    sheetFiles.find((f) =>
      normalizeText(f.name).includes(normalizeText(preferredSpreadsheetName))
    ) ??
    sheetFiles.find(
      (f) =>
        normalizeText(f.name).includes('barreto') &&
        normalizeText(f.name).includes('honorario')
    ) ??
    sheetFiles.find((f) => normalizeText(f.name).includes('barreto')) ??
    sheetFiles[0] ??
    null;

  // 2. Read-Only listing of Drive folders ("Clientes Tráfego Pago" / "Cliente Tráfego Pago")
  const folders = await listAllDriveFolders(accessToken);
  const driveSummary = analyzeDriveArchitecture(folders, [
    preferredDriveRootName,
    'Clientes Tráfego Pago',
    'Cliente Tráfego Pago',
  ]);

  const stageFolderLinks: Partial<Record<DriveStage, string>> = {};
  for (const sf of driveSummary.stageFolders) {
    stageFolderLinks[sf.stage] = sf.folderUrl;
  }

  return {
    spreadsheetId: matchedSheet?.id ?? null,
    spreadsheetTitle: matchedSheet?.name ?? null,
    driveFolderId: driveSummary.rootFolderId,
    driveFolderUrl: driveSummary.rootFolderUrl,
    stageFolderLinks,
    clientFolderLinks: driveSummary.clientFolderLinks,
    driveSummary,
  };
}

export async function inspectAndFetchGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  driveSummary?: DriveArchitectureSummary,
  preferredTabTitle?: string
): Promise<SheetInspectionAndLoadResult> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // 1. Fetch spreadsheet metadata (all tabs) — strictly GET (read-only)
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(sheetId,title)`,
    { headers }
  );
  if (!metaRes.ok) {
    throw new Error('Falha ao ler metadados da planilha no Google Sheets.');
  }
  const metaJson = await metaRes.json();
  const spreadsheetTitle: string =
    metaJson?.properties?.title ?? 'Barreto — Honorários (Ads Família)';
  const rawSheets: Array<{ properties?: { sheetId?: number; title?: string } }> =
    metaJson?.sheets ?? [];

  const tabMetaList = rawSheets
    .map((s, idx) => ({
      sheetId: Number(s.properties?.sheetId ?? idx),
      title: String(s.properties?.title ?? `Aba ${idx + 1}`),
    }))
    .filter((t) => t.title.length > 0);

  if (tabMetaList.length === 0) {
    return {
      spreadsheetTitle,
      activeTabTitle: 'Página1',
      tabs: [],
      tabRowsByTitle: {},
      clients: [],
    };
  }

  // 2. Batch-get values from all tabs in a single read-only GET call
  const rangesParams = tabMetaList
    .map((t) => `ranges=${encodeURIComponent(`'${t.title.replace(/'/g, "''")}'`)}`)
    .join('&');

  const batchRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${rangesParams}&valueRenderOption=FORMATTED_VALUE`,
    { headers }
  );
  if (!batchRes.ok) {
    throw new Error('Falha ao ler as abas e colunas da planilha no Google Sheets.');
  }
  const batchJson = await batchRes.json();
  const valueRanges: Array<{ range?: string; values?: unknown[][] }> =
    batchJson?.valueRanges ?? [];

  const tabRowsByTitle: Record<string, unknown[][]> = {};
  const tabs: SheetTabArchitecture[] = tabMetaList.map((tabMeta, idx) => {
    const rows = valueRanges[idx]?.values ?? [];
    tabRowsByTitle[tabMeta.title] = rows;
    return inspectTabArchitecture(tabMeta.title, tabMeta.sheetId, rows);
  });

  const requestedTab = preferredTabTitle
    ? tabs.find((t) => t.title === preferredTabTitle)
    : undefined;
  const chosenTab = requestedTab ?? chooseBestClientsTab(tabs) ?? tabs[0];
  const activeRows = tabRowsByTitle[chosenTab.title] ?? [];
  const clients = parseSheetTabToClients(activeRows, driveSummary);

  return {
    spreadsheetTitle,
    activeTabTitle: chosenTab.title,
    tabs,
    tabRowsByTitle,
    clients,
  };
}

export async function fetchClientsFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  clientFolderLinks: Record<string, string> = {}
): Promise<{ sheetTabTitle: string; clients: ClientCase[] }> {
  const result = await inspectAndFetchGoogleSheet(accessToken, spreadsheetId, {
    rootFolderId: null,
    rootFolderName: null,
    rootFolderUrl: null,
    stageFolders: [],
    directClientFoldersCount: 0,
    totalClientFoldersCount: Object.keys(clientFolderLinks).length,
    sampleClientFolderNames: [],
    clientFolderLinks,
    clientStageByName: {},
  });
  return { sheetTabTitle: result.activeTabTitle, clients: result.clients };
}

export async function updateInstallmentInGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetTabTitle: string,
  rowNumber: number,
  updates: { statusOrPaidDate?: string; newDueDate?: string }
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  if (updates.newDueDate) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetTabTitle}!E${rowNumber}`)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ values: [[updates.newDueDate]] }),
      }
    );
  }

  if (updates.statusOrPaidDate) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetTabTitle}!F${rowNumber}`)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ values: [[updates.statusOrPaidDate]] }),
      }
    );
  }
}

export async function syncCalendarBillingEvent(
  accessToken: string,
  params: {
    summary: string;
    description: string;
    dateISO: string;
    eventId?: string;
  }
): Promise<string | undefined> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Standard reference time: 13h30 to 14h30 (America/Sao_Paulo)
  const payload = {
    summary: params.summary,
    description: params.description,
    start: {
      dateTime: `${params.dateISO}T13:30:00-03:00`,
      timeZone: 'America/Sao_Paulo',
    },
    end: {
      dateTime: `${params.dateISO}T14:30:00-03:00`,
      timeZone: 'America/Sao_Paulo',
    },
  };

  if (params.eventId) {
    const patchRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
      }
    );
    if (patchRes.ok) {
      const json = await patchRes.json();
      return json.id;
    }
  }

  const createRes = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }
  );
  if (!createRes.ok) {
    throw new Error('Não foi possível atualizar o evento no Google Calendar.');
  }
  const created = await createRes.json();
  return created.id;
}

/**
 * Leitor do Web App do Google Apps Script em MODO SOMENTE LEITURA.
 * Executa exclusivamente fetch GET (sem alterações na planilha ou agenda).
 */
export async function syncFromAppsScriptUrl(
  appsScriptUrl: string = DEFAULT_APPS_SCRIPT_URL
): Promise<AppsScriptSyncResult> {
  const targetUrl = (appsScriptUrl || '').trim() || DEFAULT_APPS_SCRIPT_URL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APPS_SCRIPT_SYNC_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        'Tempo limite excedido ao sincronizar a planilha e o Google Drive. Tente novamente em instantes.'
      );
    }
    throw new Error(
      'Falha de conexão ao consultar o Web App do Google Apps Script. Verifique sua internet e tente novamente.'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(
      `O Web App retornou erro ${res.status}. Verifique se a implantação está como "Qualquer pessoa".`
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(
      'O Web App respondeu, mas não retornou JSON válido. Verifique se o acesso do Apps Script está como "Qualquer pessoa".'
    );
  }

  // Novo contrato oficial do Apps Script: { clientes, parcelas, driveEtapas, eventosAgenda }
  if (
    json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    ('clientes' in json ||
      'parcelas' in json ||
      'driveEtapas' in json ||
      'eventosAgenda' in json)
  ) {
    return mapAppsScriptPayload(json);
  }

  // Fallback para formato legado em array simples
  const rawList = Array.isArray(json)
    ? json
    : (json as Record<string, unknown>)?.clients ??
      (json as Record<string, unknown>)?.data ??
      [];
  if (!Array.isArray(rawList)) {
    throw new Error('Formato de resposta inesperado do Google Apps Script.');
  }

  const legacyClients: ClientCase[] = rawList.map((item: any, index: number) => {
    const id = String(item.id ?? `as-${index + 1}`);
    const fullName = String(item.fullName ?? item.nome ?? item.cliente ?? 'Cliente');
    const installmentsRaw = Array.isArray(item.installments ?? item.parcelas)
      ? item.installments ?? item.parcelas
      : [];

    const installments: Installment[] = installmentsRaw.map(
      (p: any, pIdx: number) => ({
        id: String(p.id ?? `${id}-p${pIdx + 1}`),
        clientId: id,
        clientName: fullName,
        installmentNumber: Number(p.installmentNumber ?? p.numero ?? pIdx + 1),
        totalInstallments: Number(
          p.totalInstallments ?? p.total ?? installmentsRaw.length
        ),
        amount: parseBRLAmount(p.amount ?? p.valor),
        dueDate:
          parseFlexibleDateISO(p.dueDate ?? p.vencimento) ??
          new Date().toISOString().slice(0, 10),
        paidDate: parseFlexibleDateISO(p.paidDate ?? p.dataPagamento),
      })
    );

    const contractedTotal =
      parseBRLAmount(item.contractedTotal ?? item.totalContratado) ||
      installments.reduce((sum, inst) => sum + inst.amount, 0);

    return {
      id,
      fullName,
      phone: String(item.phone ?? item.telefone ?? '11999999999'),
      caseType: String(item.caseType ?? item.acao ?? 'Direito de Família'),
      processNumber: item.processNumber ?? item.processo,
      driveStage: resolveStage(item.driveStage ?? item.etapa),
      driveFolderUrl:
        String(item.driveFolderUrl ?? item.linkDrive ?? '') ||
        'https://drive.google.com/drive/my-drive',
      modality: resolveModality(item.modality ?? item.modalidade),
      contractedTotal,
      notes: item.notes ?? item.observacoes,
      installments,
    };
  });

  const legacyInstallmentsCount = legacyClients.reduce(
    (sum, c) => sum + c.installments.length,
    0
  );

  return {
    clients: legacyClients,
    calendarEvents: [],
    driveEtapas: [],
    summary: {
      syncedAt: new Date().toISOString(),
      clientesCount: legacyClients.length,
      parcelasCount: legacyInstallmentsCount,
      driveEtapasCount: 0,
      matchedDriveCount: 0,
      driveFilesCount: 0,
      eventosAgendaCount: 0,
    },
  };
}

/**
 * Leitura sob demanda de arquivo no Google Drive (SOMENTE LEITURA via GET).
 * Consulta `${appsScriptUrl}?acao=lerArquivo&fileId=${fileId}`.
 */
export async function fetchDriveFileContent(
  appsScriptUrl: string,
  fileId: string
): Promise<DriveFileContentResponse> {
  const cleanUrl = appsScriptUrl.trim();
  if (!cleanUrl) {
    throw new Error(
      'Configure a URL do Web App do Google Apps Script antes de ler documentos do Drive.'
    );
  }
  if (!fileId.trim()) {
    throw new Error('Identificador do arquivo no Drive não informado.');
  }

  const endpoint = new URL(cleanUrl);
  endpoint.searchParams.set('acao', 'lerArquivo');
  endpoint.searchParams.set('fileId', fileId.trim());

  const res = await fetch(endpoint.toString(), {
    method: 'GET',
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(
      `Não foi possível ler o arquivo no Drive (erro ${res.status}).`
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(
      'O Apps Script não retornou JSON válido ao ler o arquivo do Drive.'
    );
  }

  if (data.error || data.erro) {
    throw new Error(String(data.error ?? data.erro));
  }

  const formatoRaw = String(data.formato ?? '').toLowerCase().trim();
  const formato: 'base64' | 'texto' =
    formatoRaw === 'base64' ? 'base64' : 'texto';
  const conteudo = String(data.conteudo ?? '');

  if (!conteudo) {
    throw new Error(
      'O arquivo selecionado não possui conteúdo legível retornado pelo Apps Script.'
    );
  }

  return {
    nome: String(data.nome ?? 'Documento'),
    mimeType: String(
      data.mimeType ??
        (formato === 'base64' ? 'application/pdf' : 'text/plain')
    ),
    formato,
    conteudo,
  };
}

/**
 * Mantido apenas para compatibilidade futura; bloqueado por padrão em MODO SOMENTE LEITURA.
 */
export async function postActionToAppsScript(
  appsScriptUrl: string,
  payload: Record<string, unknown>,
  readOnlyMode = true
): Promise<void> {
  if (readOnlyMode || !appsScriptUrl.trim()) {
    return;
  }
  await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
}
