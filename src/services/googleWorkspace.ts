import type {
  AppsScriptSyncResult,
  ClientCase,
  DriveArchitectureSummary,
  DriveFileContentResponse,
  DriveFolderNode,
  DriveStage,
  Installment,
  SheetTabArchitecture,
} from '../types/honorarios.ts';
import {
  analyzeDriveArchitecture,
  chooseBestClientsTab,
  inspectTabArchitecture,
  isValidDriveFolderUrl,
  normalizeText,
  parseBRLAmountStrict,
  parseFlexibleDateStrict,
  parseSheetTabToClients,
  resolveModality,
  resolveStage,
} from '../utils/sheetArchitecture.ts';
import {
  mapAppsScriptPayload,
  runPortfolioHealthCheck,
  type EnrichedAppsScriptSyncResult,
  type EnrichedClientCase,
  type RowParseIssue,
} from '../utils/appsScriptMapper.ts';

export const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxz9gSeBsBVBAWNbLZOn4S4NSWQop7sk7FokMc_0bFzDqdLxRzGlmkDYAe1fFA5ruM2wA/exec';

const APPS_SCRIPT_SYNC_TIMEOUT_MS = 75_000;
const SWR_DEFAULT_FRESH_TTL_MS = 60_000; // 60s fresh
const SWR_DEFAULT_MAX_STALE_MS = 30 * 60_000; // 30m stale-while-revalidate window
const SWR_STORAGE_PREFIX = 'barreto_swr_sync_v2:';
const SHEETS_BATCH_TAB_CHUNK_SIZE = 10;

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

export interface SyncCacheEntry {
  url: string;
  data: EnrichedAppsScriptSyncResult;
  cachedAt: number;
  freshUntil: number;
  expiresAt: number;
}

export interface StaleWhileRevalidateOptions {
  forceRefresh?: boolean;
  freshTtlMs?: number;
  maxStaleMs?: number;
  onRevalidated?: (fresh: EnrichedAppsScriptSyncResult) => void;
  onRevalidationError?: (error: Error) => void;
}

export interface StaleWhileRevalidateResult {
  data: EnrichedAppsScriptSyncResult;
  fromCache: boolean;
  isStale: boolean;
  revalidating: boolean;
  backgroundRevalidation?: Promise<EnrichedAppsScriptSyncResult>;
}

export type AtomicStepOutcome = 'completed' | 'failed' | 'skipped';

export interface AtomicRetryAction {
  step: 'calendar' | 'drive';
  action: 'sync_calendar_event' | 'ensure_drive_folder';
  description: string;
  payload: Record<string, unknown>;
}

export interface AtomicStepDetail {
  status: AtomicStepOutcome;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AtomicTransactionResult<TData = Record<string, unknown>> {
  ok: boolean;
  ssotCommitted: boolean;
  partialFailure: boolean;
  blockedByReadOnly?: boolean;
  steps: {
    sheets: AtomicStepDetail;
    calendar: AtomicStepDetail;
    drive: AtomicStepDetail;
  };
  warnings: string[];
  retryActions: AtomicRetryAction[];
  data?: TData;
}

const memorySyncCache = new Map<string, SyncCacheEntry>();
const inFlightSyncs = new Map<string, Promise<EnrichedAppsScriptSyncResult>>();

function getBrowserStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage environments
  }
  return null;
}

function readPersistentCache(url: string): SyncCacheEntry | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${SWR_STORAGE_PREFIX}${url}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncCacheEntry;
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistentCache(entry: SyncCacheEntry): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(`${SWR_STORAGE_PREFIX}${entry.url}`, JSON.stringify(entry));
  } catch {
    // Ignore storage quota errors
  }
}

function deletePersistentCache(url?: string): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    if (url) {
      storage.removeItem(`${SWR_STORAGE_PREFIX}${url}`);
      return;
    }
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(SWR_STORAGE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      storage.removeItem(k);
    }
  } catch {
    // Ignore storage errors
  }
}

function resolveCacheEntry(url: string, now: number): SyncCacheEntry | null {
  const mem = memorySyncCache.get(url);
  if (mem) {
    if (now <= mem.expiresAt) return mem;
    memorySyncCache.delete(url);
  }
  const persisted = readPersistentCache(url);
  if (persisted && now <= persisted.expiresAt) {
    memorySyncCache.set(url, persisted);
    return persisted;
  }
  return null;
}

function storeCacheEntry(
  url: string,
  data: EnrichedAppsScriptSyncResult,
  freshTtlMs: number = SWR_DEFAULT_FRESH_TTL_MS,
  maxStaleMs: number = SWR_DEFAULT_MAX_STALE_MS
): SyncCacheEntry {
  const now = Date.now();
  const entry: SyncCacheEntry = {
    url,
    data,
    cachedAt: now,
    freshUntil: now + freshTtlMs,
    expiresAt: now + maxStaleMs,
  };
  memorySyncCache.set(url, entry);
  writePersistentCache(entry);
  return entry;
}

export function getCachedAppsScriptSync(
  appsScriptUrl: string = DEFAULT_APPS_SCRIPT_URL
): SyncCacheEntry | null {
  const targetUrl = (appsScriptUrl || '').trim() || DEFAULT_APPS_SCRIPT_URL;
  return resolveCacheEntry(targetUrl, Date.now());
}

export function invalidateAppsScriptSyncCache(appsScriptUrl?: string): void {
  if (appsScriptUrl) {
    const targetUrl = appsScriptUrl.trim() || DEFAULT_APPS_SCRIPT_URL;
    memorySyncCache.delete(targetUrl);
    inFlightSyncs.delete(targetUrl);
    deletePersistentCache(targetUrl);
    return;
  }
  memorySyncCache.clear();
  inFlightSyncs.clear();
  deletePersistentCache();
}

// ---------------------------------------------------------------------------
// 1. Batched & Paginated Google Drive / Google Sheets Readers
// ---------------------------------------------------------------------------

async function listAllDriveFolders(
  accessToken: string,
  options?: { maxPages?: number; pageSize?: number }
): Promise<DriveFolderNode[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const folderQuery = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const maxPages = Math.min(Math.max(options?.maxPages ?? 25, 1), 50);
  const pageSize = Math.min(Math.max(options?.pageSize ?? 200, 50), 1000);

  const collected: DriveFolderNode[] = [];
  let pageToken: string | undefined = undefined;
  let pageCount = 0;

  do {
    const pageParam: string = pageToken
      ? `&pageToken=${encodeURIComponent(pageToken)}`
      : '';
    const res: Response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=nextPageToken,files(id,name,webViewLink,parents)&pageSize=${pageSize}${pageParam}`,
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
  } while (pageToken && pageCount < maxPages);

  return collected;
}

/**
 * Fetches sheet tab values in chunked `values:batchGet` batches so large spreadsheets
 * with many tabs never exceed URL limits or saturate a single request.
 */
export async function batchFetchSheetRanges(
  accessToken: string,
  spreadsheetId: string,
  tabTitles: string[],
  chunkSize: number = SHEETS_BATCH_TAB_CHUNK_SIZE
): Promise<Record<string, unknown[][]>> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const safeChunkSize = Math.max(1, Math.min(chunkSize, 25));
  const result: Record<string, unknown[][]> = {};

  for (let i = 0; i < tabTitles.length; i += safeChunkSize) {
    const chunk = tabTitles.slice(i, i + safeChunkSize);
    const rangesParams = chunk
      .map((title) => `ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`)
      .join('&');

    const batchRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${rangesParams}&valueRenderOption=FORMATTED_VALUE`,
      { headers }
    );
    if (!batchRes.ok) {
      throw new Error(
        `Falha ao ler lote de abas (${i + 1}-${i + chunk.length}) da planilha no Google Sheets.`
      );
    }
    const batchJson = (await batchRes.json()) as {
      valueRanges?: Array<{ range?: string; values?: unknown[][] }>;
    };
    const valueRanges = batchJson?.valueRanges ?? [];
    chunk.forEach((title, idx) => {
      result[title] = valueRanges[idx]?.values ?? [];
    });
  }

  return result;
}

export async function discoverBarretoWorkspace(
  accessToken: string,
  preferredSpreadsheetName = 'Barreto — Honorários (Ads Família)',
  preferredDriveRootName = 'Clientes Tráfego Pago'
): Promise<WorkspaceDiscoveryResult> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Run Spreadsheet discovery and paginated Drive folder discovery in parallel
  const sheetQuery = encodeURIComponent(
    `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
  );
  const [sheetRes, folders] = await Promise.all([
    fetch(
      `https://www.googleapis.com/drive/v3/files?q=${sheetQuery}&fields=files(id,name,webViewLink)&pageSize=50`,
      { headers }
    ),
    listAllDriveFolders(accessToken),
  ]);

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

  // 2. Chunked batch-get values across all tabs
  const tabRowsByTitle = await batchFetchSheetRanges(
    accessToken,
    spreadsheetId,
    tabMetaList.map((t) => t.title)
  );

  const tabs: SheetTabArchitecture[] = tabMetaList.map((tabMeta) => {
    const rows = tabRowsByTitle[tabMeta.title] ?? [];
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

// ---------------------------------------------------------------------------
// 2. Direct Sheets / Calendar / Drive Primitive Writers (used by Atomic Flows)
// ---------------------------------------------------------------------------

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
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetTabTitle}!E${rowNumber}`)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ values: [[updates.newDueDate]] }),
      }
    );
    if (!res.ok) {
      throw new Error(
        `Falha ao atualizar vencimento na planilha (HTTP ${res.status}).`
      );
    }
  }

  if (updates.statusOrPaidDate) {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetTabTitle}!F${rowNumber}`)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ values: [[updates.statusOrPaidDate]] }),
      }
    );
    if (!res.ok) {
      throw new Error(
        `Falha ao gravar baixa/status da parcela na planilha (HTTP ${res.status}).`
      );
    }
  }
}

export async function appendClientRowsToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetTabTitle: string,
  client: ClientCase
): Promise<{ updatedRange?: string; rowsWritten: number }> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const formatAmountBR = (val: number) =>
    `R$ ${val.toFixed(2).replace('.', ',')}`;

  const rows: unknown[][] =
    client.installments.length > 0
      ? client.installments.map((inst) => [
          client.fullName,
          client.phone,
          client.caseType,
          formatAmountBR(inst.amount),
          inst.dueDate,
          inst.paidDate ?? 'Em aberto',
          `${inst.installmentNumber}/${inst.totalInstallments}`,
          client.driveStage,
          client.modality,
          client.driveFolderUrl,
        ])
      : [
          [
            client.fullName,
            client.phone,
            client.caseType,
            formatAmountBR(client.contractedTotal),
            '',
            'Em aberto',
            '1/1',
            client.driveStage,
            client.modality,
            client.driveFolderUrl,
          ],
        ];

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${sheetTabTitle}!A:J`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ values: rows }),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Falha ao gravar novo cliente na planilha SSOT (HTTP ${res.status}).`
    );
  }

  const json = (await res.json().catch(() => ({}))) as {
    updates?: { updatedRange?: string };
  };

  return {
    updatedRange: json?.updates?.updatedRange,
    rowsWritten: rows.length,
  };
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
 * Ensures a client folder exists in Google Drive (idempotent: reuses existing folder if found,
 * otherwise creates a new folder under parentFolderId).
 */
export async function ensureClientDriveFolder(
  accessToken: string,
  params: {
    clientName: string;
    parentFolderId?: string;
    existingFolderUrl?: string;
  }
): Promise<{ folderId?: string; folderUrl: string; created: boolean }> {
  const cleanName = params.clientName.trim();
  if (!cleanName) {
    throw new Error('Nome do cliente obrigatório para garantir pasta no Drive.');
  }

  if (isValidDriveFolderUrl(params.existingFolderUrl)) {
    return {
      folderUrl: params.existingFolderUrl!,
      created: false,
    };
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const escapedName = cleanName.replace(/'/g, "\\'");
  const parentClause = params.parentFolderId
    ? ` and '${params.parentFolderId.replace(/'/g, "\\'")}' in parents`
    : '';
  const query = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${escapedName}'${parentClause}`
  );

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)&pageSize=5`,
    { headers }
  );
  if (!searchRes.ok) {
    throw new Error(
      `Falha ao verificar pasta do cliente no Google Drive (HTTP ${searchRes.status}).`
    );
  }
  const searchJson = (await searchRes.json()) as {
    files?: Array<{ id?: string; webViewLink?: string }>;
  };
  const existing = searchJson.files?.[0];
  if (existing?.id) {
    return {
      folderId: existing.id,
      folderUrl:
        existing.webViewLink ||
        `https://drive.google.com/drive/folders/${existing.id}`,
      created: false,
    };
  }

  const createPayload: Record<string, unknown> = {
    name: cleanName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (params.parentFolderId) {
    createPayload.parents = [params.parentFolderId];
  }

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(createPayload),
    }
  );
  if (!createRes.ok) {
    throw new Error(
      `Falha ao criar pasta do cliente no Google Drive (HTTP ${createRes.status}).`
    );
  }
  const created = (await createRes.json()) as {
    id?: string;
    webViewLink?: string;
  };
  if (!created.id) {
    throw new Error('Google Drive não retornou ID da pasta criada.');
  }

  return {
    folderId: created.id,
    folderUrl:
      created.webViewLink ||
      `https://drive.google.com/drive/folders/${created.id}`,
    created: true,
  };
}

// ---------------------------------------------------------------------------
// 3. Atomic Sequential Transactions (Step 1 Sheets -> Step 2 Calendar -> Step 3 Drive)
// ---------------------------------------------------------------------------

/**
 * Atomic sequential client registration:
 *   Step 1: Commit to Google Sheets (SSOT). Aborts if Step 1 fails.
 *   Step 2: Create pending billing events in Google Calendar.
 *   Step 3: Ensure client folder in Google Drive.
 *
 * If Step 2 or Step 3 fail, Step 1 (Google Sheets) is NEVER rolled back;
 * structured retry actions are returned so the frontend can recreate missing operational records.
 */
export async function executeAtomicClientRegistration(params: {
  accessToken: string;
  spreadsheetId: string;
  sheetTabTitle: string;
  client: ClientCase;
  parentDriveFolderId?: string;
  readOnlyMode?: boolean;
  appsScriptUrlToInvalidate?: string;
}): Promise<
  AtomicTransactionResult<{
    updatedRange?: string;
    calendarEventIds: Record<string, string>;
    driveFolderUrl?: string;
  }>
> {
  if (params.readOnlyMode) {
    return {
      ok: false,
      ssotCommitted: false,
      partialFailure: false,
      blockedByReadOnly: true,
      steps: {
        sheets: { status: 'skipped', error: 'Modo somente leitura ativo.' },
        calendar: { status: 'skipped' },
        drive: { status: 'skipped' },
      },
      warnings: [
        'Operação bloqueada porque o Modo Somente Leitura está ativo.',
      ],
      retryActions: [],
    };
  }

  const warnings: string[] = [];
  const retryActions: AtomicRetryAction[] = [];
  const calendarEventIds: Record<string, string> = {};
  let updatedRange: string | undefined;
  let driveFolderUrl: string | undefined = isValidDriveFolderUrl(
    params.client.driveFolderUrl
  )
    ? params.client.driveFolderUrl
    : undefined;

  // STEP 1 (SSOT): Write to Google Sheets first
  try {
    const sheetResult = await appendClientRowsToGoogleSheet(
      params.accessToken,
      params.spreadsheetId,
      params.sheetTabTitle,
      params.client
    );
    updatedRange = sheetResult.updatedRange;
    invalidateAppsScriptSyncCache(params.appsScriptUrlToInvalidate);
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Falha ao gravar cliente na planilha (SSOT).';
    return {
      ok: false,
      ssotCommitted: false,
      partialFailure: false,
      steps: {
        sheets: { status: 'failed', error: msg },
        calendar: { status: 'skipped' },
        drive: { status: 'skipped' },
      },
      warnings: [msg],
      retryActions: [],
    };
  }

  // STEP 2 (Operational Reflection): Create Calendar billing events for pending installments
  const pendingInstallments = params.client.installments.filter(
    (inst) => !inst.paidDate
  );
  let calendarStep: AtomicStepDetail = { status: 'completed' };

  if (pendingInstallments.length === 0) {
    calendarStep = {
      status: 'skipped',
      metadata: { reason: 'Sem parcelas pendentes para agendar.' },
    };
  } else {
    const calendarErrors: string[] = [];
    for (const inst of pendingInstallments) {
      const eventParams = {
        summary: `Cobrança Honorários — ${params.client.fullName}`,
        description: `Parcela ${inst.installmentNumber}/${inst.totalInstallments} · R$ ${inst.amount.toFixed(2).replace('.', ',')} · ${params.client.caseType}`,
        dateISO: inst.dueDate,
        eventId: inst.calendarEventId,
      };
      try {
        const eventId = await syncCalendarBillingEvent(
          params.accessToken,
          eventParams
        );
        if (eventId) {
          calendarEventIds[inst.id] = eventId;
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Erro ao criar evento no Google Calendar.';
        calendarErrors.push(`${inst.dueDate}: ${msg}`);
        retryActions.push({
          step: 'calendar',
          action: 'sync_calendar_event',
          description: `Recriar evento de cobrança da parcela ${inst.installmentNumber}/${inst.totalInstallments} (${inst.dueDate})`,
          payload: {
            clientId: params.client.id,
            installmentId: inst.id,
            ...eventParams,
          },
        });
      }
    }

    if (calendarErrors.length > 0) {
      const joined = `Planilha gravada, mas ${calendarErrors.length} evento(s) do Calendar falharam: ${calendarErrors.join('; ')}`;
      warnings.push(joined);
      calendarStep = {
        status: 'failed',
        error: joined,
        metadata: { createdCount: Object.keys(calendarEventIds).length },
      };
    } else {
      calendarStep = {
        status: 'completed',
        metadata: { createdCount: Object.keys(calendarEventIds).length },
      };
    }
  }

  // STEP 3 (Operational Reflection): Ensure client folder in Google Drive
  let driveStep: AtomicStepDetail;
  try {
    const folder = await ensureClientDriveFolder(params.accessToken, {
      clientName: params.client.fullName,
      parentFolderId: params.parentDriveFolderId,
      existingFolderUrl: params.client.driveFolderUrl,
    });
    driveFolderUrl = folder.folderUrl;
    driveStep = {
      status: 'completed',
      metadata: {
        folderId: folder.folderId,
        folderUrl: folder.folderUrl,
        created: folder.created,
      },
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Erro ao garantir pasta do cliente no Google Drive.';
    const warning = `Planilha gravada, mas a pasta no Drive não pôde ser garantida: ${msg}`;
    warnings.push(warning);
    retryActions.push({
      step: 'drive',
      action: 'ensure_drive_folder',
      description: `Garantir pasta no Google Drive para ${params.client.fullName}`,
      payload: {
        clientId: params.client.id,
        clientName: params.client.fullName,
        parentFolderId: params.parentDriveFolderId,
      },
    });
    driveStep = { status: 'failed', error: warning };
  }

  const partialFailure =
    calendarStep.status === 'failed' || driveStep.status === 'failed';

  return {
    ok: true,
    ssotCommitted: true,
    partialFailure,
    steps: {
      sheets: {
        status: 'completed',
        metadata: { updatedRange },
      },
      calendar: calendarStep,
      drive: driveStep,
    },
    warnings,
    retryActions,
    data: {
      updatedRange,
      calendarEventIds,
      driveFolderUrl,
    },
  };
}

/**
 * Atomic sequential installment payment (baixa de parcela):
 *   Step 1: Mark installment paid in Google Sheets (SSOT). Aborts if Step 1 fails.
 *   Step 2: Update Google Calendar billing event as paid.
 *   Step 3: Ensure client folder exists in Google Drive.
 *
 * Never rolls back Google Sheets if Calendar or Drive fails; returns structured retryActions.
 */
export async function executeAtomicInstallmentPayment(params: {
  accessToken: string;
  spreadsheetId: string;
  sheetTabTitle: string;
  client: ClientCase;
  installment: Installment;
  paidDateISO: string;
  parentDriveFolderId?: string;
  readOnlyMode?: boolean;
  appsScriptUrlToInvalidate?: string;
}): Promise<
  AtomicTransactionResult<{
    calendarEventId?: string;
    driveFolderUrl?: string;
  }>
> {
  if (params.readOnlyMode) {
    return {
      ok: false,
      ssotCommitted: false,
      partialFailure: false,
      blockedByReadOnly: true,
      steps: {
        sheets: { status: 'skipped', error: 'Modo somente leitura ativo.' },
        calendar: { status: 'skipped' },
        drive: { status: 'skipped' },
      },
      warnings: [
        'Baixa bloqueada porque o Modo Somente Leitura está ativo.',
      ],
      retryActions: [],
    };
  }

  if (!params.installment.sheetRowNumber) {
    const msg =
      'Número da linha na planilha não encontrado para efetuar a baixa atômica.';
    return {
      ok: false,
      ssotCommitted: false,
      partialFailure: false,
      steps: {
        sheets: { status: 'failed', error: msg },
        calendar: { status: 'skipped' },
        drive: { status: 'skipped' },
      },
      warnings: [msg],
      retryActions: [],
    };
  }

  const warnings: string[] = [];
  const retryActions: AtomicRetryAction[] = [];

  // STEP 1 (SSOT): Persist payment date in Google Sheets
  try {
    await updateInstallmentInGoogleSheet(
      params.accessToken,
      params.spreadsheetId,
      params.sheetTabTitle,
      params.installment.sheetRowNumber,
      { statusOrPaidDate: params.paidDateISO }
    );
    invalidateAppsScriptSyncCache(params.appsScriptUrlToInvalidate);
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Falha ao gravar baixa da parcela na planilha (SSOT).';
    return {
      ok: false,
      ssotCommitted: false,
      partialFailure: false,
      steps: {
        sheets: { status: 'failed', error: msg },
        calendar: { status: 'skipped' },
        drive: { status: 'skipped' },
      },
      warnings: [msg],
      retryActions: [],
    };
  }

  // STEP 2 (Operational Reflection): Update Google Calendar event
  let calendarEventId: string | undefined = params.installment.calendarEventId;
  let calendarStep: AtomicStepDetail;
  const calendarPayload = {
    summary: `[PAGO] Cobrança Honorários — ${params.client.fullName}`,
    description: `Parcela ${params.installment.installmentNumber}/${params.installment.totalInstallments} quitada em ${params.paidDateISO} · R$ ${params.installment.amount.toFixed(2).replace('.', ',')}`,
    dateISO: params.installment.dueDate,
    eventId: params.installment.calendarEventId,
  };

  try {
    calendarEventId = await syncCalendarBillingEvent(
      params.accessToken,
      calendarPayload
    );
    calendarStep = {
      status: 'completed',
      metadata: { calendarEventId },
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Erro ao atualizar evento no Google Calendar.';
    const warning = `Baixa gravada na planilha, mas o evento no Calendar falhou: ${msg}`;
    warnings.push(warning);
    retryActions.push({
      step: 'calendar',
      action: 'sync_calendar_event',
      description: `Atualizar evento de baixa no Calendar (${params.client.fullName} · ${params.installment.dueDate})`,
      payload: {
        clientId: params.client.id,
        installmentId: params.installment.id,
        ...calendarPayload,
      },
    });
    calendarStep = { status: 'failed', error: warning };
  }

  // STEP 3 (Operational Reflection): Ensure client folder exists in Google Drive
  let driveFolderUrl: string | undefined = isValidDriveFolderUrl(
    params.client.driveFolderUrl
  )
    ? params.client.driveFolderUrl
    : undefined;
  let driveStep: AtomicStepDetail;

  try {
    const folder = await ensureClientDriveFolder(params.accessToken, {
      clientName: params.client.fullName,
      parentFolderId: params.parentDriveFolderId,
      existingFolderUrl: params.client.driveFolderUrl,
    });
    driveFolderUrl = folder.folderUrl;
    driveStep = {
      status: 'completed',
      metadata: {
        folderId: folder.folderId,
        folderUrl: folder.folderUrl,
        created: folder.created,
      },
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Erro ao verificar/criar pasta no Google Drive.';
    const warning = `Baixa gravada na planilha, mas a pasta no Drive não pôde ser verificada: ${msg}`;
    warnings.push(warning);
    retryActions.push({
      step: 'drive',
      action: 'ensure_drive_folder',
      description: `Garantir pasta no Google Drive para ${params.client.fullName}`,
      payload: {
        clientId: params.client.id,
        clientName: params.client.fullName,
        parentFolderId: params.parentDriveFolderId,
      },
    });
    driveStep = { status: 'failed', error: warning };
  }

  const partialFailure =
    calendarStep.status === 'failed' || driveStep.status === 'failed';

  return {
    ok: true,
    ssotCommitted: true,
    partialFailure,
    steps: {
      sheets: {
        status: 'completed',
        metadata: {
          rowNumber: params.installment.sheetRowNumber,
          paidDateISO: params.paidDateISO,
        },
      },
      calendar: calendarStep,
      drive: driveStep,
    },
    warnings,
    retryActions,
    data: {
      calendarEventId,
      driveFolderUrl,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Apps Script Sync + Stale-While-Revalidate (SWR) & Server Batch Client
// ---------------------------------------------------------------------------

function mapLegacyAppsScriptArray(rawList: unknown[]): EnrichedAppsScriptSyncResult {
  const parseIssues: RowParseIssue[] = [];
  const legacyClients: ClientCase[] = [];

  rawList.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    const id = String(item.id ?? `as-${index + 1}`);
    const fullName = String(
      item.fullName ?? item.nome ?? item.cliente ?? 'Cliente'
    );
    const installmentsRaw = Array.isArray(item.installments ?? item.parcelas)
      ? ((item.installments ?? item.parcelas) as Record<string, unknown>[])
      : [];

    const installments: Installment[] = installmentsRaw
      .map((p, pIdx): Installment | null => {
        const rowId = String(p.id ?? `${id}-p${pIdx + 1}`);
        const amountParsed = parseBRLAmountStrict(p.amount ?? p.valor);
        if (!amountParsed.ok) {
          parseIssues.push({
            scope: 'parcela',
            rowId,
            clientId: id,
            clientName: fullName,
            field: 'valor',
            rawValue: amountParsed.raw,
            reason: amountParsed.error ?? 'Valor inválido',
          });
        }
        const dueParsed = parseFlexibleDateStrict(p.dueDate ?? p.vencimento);
        if (!dueParsed.ok && !dueParsed.isEmpty) {
          parseIssues.push({
            scope: 'parcela',
            rowId,
            clientId: id,
            clientName: fullName,
            field: 'vencimento',
            rawValue: dueParsed.raw,
            reason: dueParsed.error ?? 'Data de vencimento inválida',
          });
        }
        const paidParsed = parseFlexibleDateStrict(
          p.paidDate ?? p.dataPagamento
        );
        if (!dueParsed.ok || !dueParsed.iso || amountParsed.value <= 0) {
          return null;
        }
        return {
          id: rowId,
          clientId: id,
          clientName: fullName,
          installmentNumber: Number(p.installmentNumber ?? p.numero ?? pIdx + 1),
          totalInstallments: Number(
            p.totalInstallments ?? p.total ?? installmentsRaw.length
          ),
          amount: amountParsed.value,
          dueDate: dueParsed.iso,
          paidDate: paidParsed.ok ? paidParsed.iso : undefined,
        };
      })
      .filter((inst): inst is Installment => inst !== null);

    const totalParsed = parseBRLAmountStrict(
      item.contractedTotal ?? item.totalContratado
    );
    const installmentsSum =
      Math.round(
        installments.reduce((sum, inst) => sum + inst.amount, 0) * 100
      ) / 100;
    const contractedTotal =
      totalParsed.ok && totalParsed.value > 0
        ? totalParsed.value
        : installmentsSum;

    legacyClients.push({
      id,
      fullName,
      phone: String(item.phone ?? item.telefone ?? '11999999999'),
      caseType: String(item.caseType ?? item.acao ?? 'Direito de Família'),
      processNumber: item.processNumber
        ? String(item.processNumber)
        : item.processo
          ? String(item.processo)
          : undefined,
      driveStage: resolveStage(String(item.driveStage ?? item.etapa ?? '')),
      driveFolderUrl:
        String(item.driveFolderUrl ?? item.linkDrive ?? '') ||
        'https://drive.google.com/drive/my-drive',
      modality: resolveModality(
        String(item.modality ?? item.modalidade ?? '')
      ),
      contractedTotal,
      notes: item.notes
        ? String(item.notes)
        : item.observacoes
          ? String(item.observacoes)
          : undefined,
      installments,
    });
  });

  const healthReport = runPortfolioHealthCheck(
    legacyClients,
    [],
    [],
    parseIssues
  );

  const enrichedClients: EnrichedClientCase[] = legacyClients.map((c) => ({
    ...c,
    syncWarnings: healthReport.warningsByClientId[c.id] ?? [],
    healthCheck: healthReport.healthByClientId[c.id],
  }));

  const legacyInstallmentsCount = enrichedClients.reduce(
    (sum, c) => sum + c.installments.length,
    0
  );

  return {
    clients: enrichedClients,
    calendarEvents: [],
    driveEtapas: [],
    parseIssues,
    healthReport,
    summary: {
      syncedAt: new Date().toISOString(),
      clientesCount: enrichedClients.length,
      parcelasCount: legacyInstallmentsCount,
      driveEtapasCount: 0,
      matchedDriveCount: 0,
      driveFilesCount: 0,
      eventosAgendaCount: 0,
    },
  };
}

async function fetchAppsScriptNetwork(
  targetUrl: string
): Promise<EnrichedAppsScriptSyncResult> {
  const existingInFlight = inFlightSyncs.get(targetUrl);
  if (existingInFlight) {
    return existingInFlight;
  }

  const requestPromise = (async (): Promise<EnrichedAppsScriptSyncResult> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      APPS_SCRIPT_SYNC_TIMEOUT_MS
    );

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

    // Official Apps Script contract: { dashboard?, clientes, parcelas, pagamentos?, contratos?, zapsignConferencia?, driveEtapas, eventosAgenda }
    if (
      json &&
      typeof json === 'object' &&
      !Array.isArray(json) &&
      ('clientes' in json ||
        'parcelas' in json ||
        'pagamentos' in json ||
        'dashboard' in json ||
        'driveEtapas' in json ||
        'eventosAgenda' in json)
    ) {
      return mapAppsScriptPayload(json);
    }

    const rawList = Array.isArray(json)
      ? json
      : (json as Record<string, unknown>)?.clients ??
        (json as Record<string, unknown>)?.data ??
        [];
    if (!Array.isArray(rawList)) {
      throw new Error('Formato de resposta inesperado do Google Apps Script.');
    }

    return mapLegacyAppsScriptArray(rawList);
  })();

  inFlightSyncs.set(targetUrl, requestPromise);
  try {
    const fresh = await requestPromise;
    storeCacheEntry(targetUrl, fresh);
    return fresh;
  } finally {
    inFlightSyncs.delete(targetUrl);
  }
}

/**
 * Leitor do Web App do Google Apps Script em MODO SOMENTE LEITURA.
 * Executa exclusivamente fetch GET (sem alterações na planilha ou agenda),
 * aplica parsing rigoroso + triangulação de estado e atualiza o cache SWR.
 */
export async function syncFromAppsScriptUrl(
  appsScriptUrl: string = DEFAULT_APPS_SCRIPT_URL
): Promise<EnrichedAppsScriptSyncResult> {
  const targetUrl = (appsScriptUrl || '').trim() || DEFAULT_APPS_SCRIPT_URL;
  return fetchAppsScriptNetwork(targetUrl);
}

/**
 * Stale-While-Revalidate (SWR) loader:
 * - Fresh cache -> returns instantaneously without network wait.
 * - Stale cache -> returns mapped snapshot instantaneously so Dashboard renders immediately,
 *   while revalidating Sheets/Drive/Calendar in background and invoking `onRevalidated`.
 * - Cache miss (or `forceRefresh: true`) -> fetches fresh data and populates cache.
 */
export async function syncFromAppsScriptWithSWR(
  appsScriptUrl: string = DEFAULT_APPS_SCRIPT_URL,
  options: StaleWhileRevalidateOptions = {}
): Promise<StaleWhileRevalidateResult> {
  const targetUrl = (appsScriptUrl || '').trim() || DEFAULT_APPS_SCRIPT_URL;
  const freshTtlMs = options.freshTtlMs ?? SWR_DEFAULT_FRESH_TTL_MS;
  const maxStaleMs = options.maxStaleMs ?? SWR_DEFAULT_MAX_STALE_MS;
  const now = Date.now();

  if (!options.forceRefresh) {
    const cached = resolveCacheEntry(targetUrl, now);
    if (cached) {
      const isFresh = now <= cached.freshUntil;
      if (isFresh) {
        return {
          data: cached.data,
          fromCache: true,
          isStale: false,
          revalidating: false,
        };
      }

      // Stale hit: return immediately and revalidate in background
      const backgroundRevalidation = fetchAppsScriptNetwork(targetUrl)
        .then((fresh) => {
          storeCacheEntry(targetUrl, fresh, freshTtlMs, maxStaleMs);
          options.onRevalidated?.(fresh);
          return fresh;
        })
        .catch((err: unknown) => {
          const errorObj =
            err instanceof Error ? err : new Error(String(err ?? 'Erro SWR'));
          options.onRevalidationError?.(errorObj);
          throw errorObj;
        });

      return {
        data: cached.data,
        fromCache: true,
        isStale: true,
        revalidating: true,
        backgroundRevalidation,
      };
    }
  }

  const fresh = await fetchAppsScriptNetwork(targetUrl);
  storeCacheEntry(targetUrl, fresh, freshTtlMs, maxStaleMs);
  return {
    data: fresh,
    fromCache: false,
    isStale: false,
    revalidating: false,
  };
}

export interface ServerWorkspaceSyncOptions {
  appsScriptUrl?: string;
  forceRefresh?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ServerWorkspaceSyncResponse extends EnrichedAppsScriptSyncResult {
  cache?: {
    status: 'HIT' | 'STALE' | 'MISS';
    cachedAt: string;
    revalidating: boolean;
  };
  pagination?: {
    page: number;
    pageSize: number;
    totalClients: number;
    totalPages: number;
    hasMore: boolean;
  };
}

/**
 * Consumes the server-side batched/paginated & SWR-cached `/api/workspace/sync` proxy.
 */
export async function syncWorkspaceFromServer(
  firebaseIdToken: string,
  options: ServerWorkspaceSyncOptions = {}
): Promise<ServerWorkspaceSyncResponse> {
  const params = new URLSearchParams();
  if (options.appsScriptUrl?.trim()) {
    params.set('url', options.appsScriptUrl.trim());
  }
  if (options.forceRefresh) {
    params.set('force', 'true');
  }
  if (options.page && options.page > 0) {
    params.set('page', String(Math.floor(options.page)));
  }
  if (options.pageSize && options.pageSize > 0) {
    params.set('pageSize', String(Math.floor(options.pageSize)));
  }

  const qs = params.toString();
  const res = await fetch(`/api/workspace/sync${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${firebaseIdToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      errBody.error ||
        `Falha ao sincronizar carteira via servidor (HTTP ${res.status}).`
    );
  }

  return (await res.json()) as ServerWorkspaceSyncResponse;
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
  const res = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(
      `Falha ao enviar ação para o Google Apps Script (HTTP ${res.status}).`
    );
  }
  invalidateAppsScriptSyncCache(appsScriptUrl);
}

/**
 * Invalida o cache SWR do servidor (`/api/workspace/cache/invalidate`) e o cache local.
 * Seguro para chamada pós-gravação sem interromper o fluxo de interface em caso de rede instável.
 */
export async function invalidateServerWorkspaceCache(
  firebaseIdToken: string | null | undefined,
  appsScriptUrl?: string
): Promise<boolean> {
  invalidateAppsScriptSyncCache(appsScriptUrl);
  if (!firebaseIdToken) return false;
  try {
    const res = await fetch('/api/workspace/cache/invalidate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${firebaseIdToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        appsScriptUrl?.trim() ? { url: appsScriptUrl.trim() } : {}
      ),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Reexecuta uma ação operacional pendente (`retryActions`) gerada após sucesso
 * do Passo 1 (Planilha SSOT) com falha parcial no Calendar ou Drive.
 */
export async function executeAtomicRetryAction(
  accessToken: string,
  retryAction: AtomicRetryAction
): Promise<{
  ok: boolean;
  calendarEventId?: string;
  driveFolderUrl?: string;
  error?: string;
}> {
  if (!accessToken.trim()) {
    return {
      ok: false,
      error:
        'Conecte sua conta Google Workspace em Configurações para reexecutar esta ação.',
    };
  }

  try {
    if (retryAction.action === 'sync_calendar_event') {
      const payload = retryAction.payload;
      const summary = String(payload.summary ?? '').trim();
      const description = String(payload.description ?? '').trim();
      const dateISO = String(payload.dateISO ?? '').trim();
      const eventId = payload.eventId ? String(payload.eventId) : undefined;
      if (!summary || !dateISO) {
        return {
          ok: false,
          error: 'Dados insuficientes para recriar o evento no Google Calendar.',
        };
      }
      const calendarEventId = await syncCalendarBillingEvent(accessToken, {
        summary,
        description,
        dateISO,
        eventId,
      });
      return { ok: true, calendarEventId };
    }

    if (retryAction.action === 'ensure_drive_folder') {
      const payload = retryAction.payload;
      const clientName = String(payload.clientName ?? '').trim();
      const parentFolderId = payload.parentFolderId
        ? String(payload.parentFolderId)
        : undefined;
      if (!clientName) {
        return {
          ok: false,
          error: 'Nome do cliente ausente para garantir a pasta no Google Drive.',
        };
      }
      const folder = await ensureClientDriveFolder(accessToken, {
        clientName,
        parentFolderId,
      });
      return { ok: true, driveFolderUrl: folder.folderUrl };
    }

    return { ok: false, error: 'Tipo de ação de reexecução não suportado.' };
  } catch (err: unknown) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? err.message
          : 'Falha ao reexecutar a ação operacional.',
    };
  }
}
