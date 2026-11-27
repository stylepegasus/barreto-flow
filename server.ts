import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import type { Content, Part } from '@google/genai';
import { verifyFirebaseIdTokenAndAllowlist } from './src/utils/serverAuth.ts';
import { buildDonaSystemPrompt } from './src/utils/assistantContext.ts';
import type { ZapSignSignedDoc } from './src/types/honorarios.ts';
import {
  isExcludedZapSignFolder,
  normalizeZapSignDocsPayload,
} from './src/utils/zapsignLogic.ts';
import {
  mapAppsScriptPayload,
  type EnrichedAppsScriptSyncResult,
} from './src/utils/appsScriptMapper.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 8080;
const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_WORKSPACE_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxz9gSeBsBVBAWNbLZOn4S4NSWQop7sk7FokMc_0bFzDqdLxRzGlmkDYAe1fFA5ruM2wA/exec';
const ALLOWED_APPS_SCRIPT_HOSTS = new Set([
  'script.google.com',
  'script.googleusercontent.com',
]);
const WORKSPACE_CACHE_FRESH_TTL_MS = 15_000;
const WORKSPACE_CACHE_STALE_TTL_MS = 30 * 60_000;
const WORKSPACE_CACHE_MAX_ENTRIES = 10;
const WORKSPACE_FETCH_TIMEOUT_MS = 65_000;
const ZAPSIGN_FETCH_TIMEOUT_MS = 20_000;
const ZAPSIGN_LIST_CACHE_TTL_MS = 60_000;
const ZAPSIGN_SIGNERS_CACHE_MAX_ENTRIES = 600;
const ZAPSIGN_DETAIL_CONCURRENCY = 10;
const ZAPSIGN_DETAIL_TIMEOUT_MS = 6_000;
const ZAPSIGN_ENRICHMENT_BUDGET_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;

interface ZapSignDocDetailCacheEntry {
  signers: ZapSignSignedDoc['signers'];
  signedAt?: string;
  folderPath?: string;
  folderName?: string;
  signedFileUrl?: string;
}

const zapsignDocDetailCache = new Map<string, ZapSignDocDetailCacheEntry>();
let zapsignSignedListCache: { docs: ZapSignSignedDoc[]; cachedAt: number } | null =
  null;
let zapsignBgWarmupRunning = false;

function storeZapSignDocDetailCache(
  token: string,
  entry: ZapSignDocDetailCacheEntry
) {
  if (
    !zapsignDocDetailCache.has(token) &&
    zapsignDocDetailCache.size >= ZAPSIGN_SIGNERS_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = zapsignDocDetailCache.keys().next().value;
    if (oldestKey) zapsignDocDetailCache.delete(oldestKey);
  }
  zapsignDocDetailCache.set(token, entry);
}

/**
 * ZapSign's list endpoint (`GET /api/v1/docs/`) omits the `signers` array.
 * Enriches signed documents with bounded parallel detail calls (`GET /api/v1/docs/{token}/`)
 * and caches immutable signed-document signers in memory to keep responses fast.
 */
async function enrichZapSignDocsWithSigners(
  docs: ZapSignSignedDoc[],
  apiToken: string
): Promise<ZapSignSignedDoc[]> {
  const deadline = Date.now() + ZAPSIGN_ENRICHMENT_BUDGET_MS;
  const needsFetch: ZapSignSignedDoc[] = [];

  for (const doc of docs) {
    if (doc.signers.length > 0) continue;
    const cached = zapsignDocDetailCache.get(doc.token);
    if (cached) {
      doc.signers = cached.signers;
      if (cached.signedAt) doc.signedAt = cached.signedAt;
      if (cached.folderPath && !doc.folderPath) doc.folderPath = cached.folderPath;
      if (cached.folderName && !doc.folderName) doc.folderName = cached.folderName;
      if (cached.signedFileUrl && !doc.signedFileUrl) {
        doc.signedFileUrl = cached.signedFileUrl;
      }
    } else {
      needsFetch.push(doc);
    }
  }

  if (needsFetch.length > 0) {
    let cursor = 0;
    const workerCount = Math.min(ZAPSIGN_DETAIL_CONCURRENCY, needsFetch.length);

    const runWorker = async () => {
      while (cursor < needsFetch.length && Date.now() < deadline) {
        const idx = cursor++;
        const doc = needsFetch[idx];
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 500) break;

        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          Math.min(ZAPSIGN_DETAIL_TIMEOUT_MS, remainingMs)
        );
        try {
          const detailRes = await fetch(
            `https://api.zapsign.com.br/api/v1/docs/${encodeURIComponent(doc.token)}/`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${apiToken}`,
                Accept: 'application/json',
              },
              signal: controller.signal,
            }
          );
          if (!detailRes.ok) continue;
          const detailJson = (await detailRes.json()) as Record<string, unknown>;
          const normalized = normalizeZapSignDocsPayload([detailJson])[0];
          if (normalized) {
            doc.signers = normalized.signers;
            if (normalized.signedAt) doc.signedAt = normalized.signedAt;
            if (normalized.folderPath && !doc.folderPath) {
              doc.folderPath = normalized.folderPath;
            }
            if (normalized.folderName && !doc.folderName) {
              doc.folderName = normalized.folderName;
            }
            if (normalized.signedFileUrl && !doc.signedFileUrl) {
              doc.signedFileUrl = normalized.signedFileUrl;
            }
            storeZapSignDocDetailCache(doc.token, {
              signers: normalized.signers,
              signedAt: normalized.signedAt,
              folderPath: normalized.folderPath,
              folderName: normalized.folderName,
              signedFileUrl: normalized.signedFileUrl,
            });
          }
        } catch {
          // Best-effort enrichment; keep list-level doc if a detail lookup times out
        } finally {
          clearTimeout(timer);
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    // If the foreground budget ended before every uncached doc was enriched,
    // warm the remaining immutable signed docs in the background and invalidate the list cache.
    if (cursor < needsFetch.length && !zapsignBgWarmupRunning) {
      const remainingDocs = needsFetch.slice(cursor);
      zapsignBgWarmupRunning = true;
      void (async () => {
        try {
          let bgCursor = 0;
          const bgWorkers = Math.min(4, remainingDocs.length);
          const runBgWorker = async () => {
            while (bgCursor < remainingDocs.length) {
              const doc = remainingDocs[bgCursor++];
              if (zapsignDocDetailCache.has(doc.token)) continue;
              const controller = new AbortController();
              const timer = setTimeout(
                () => controller.abort(),
                ZAPSIGN_DETAIL_TIMEOUT_MS
              );
              try {
                const detailRes = await fetch(
                  `https://api.zapsign.com.br/api/v1/docs/${encodeURIComponent(doc.token)}/`,
                  {
                    method: 'GET',
                    headers: {
                      Authorization: `Bearer ${apiToken}`,
                      Accept: 'application/json',
                    },
                    signal: controller.signal,
                  }
                );
                if (!detailRes.ok) continue;
                const detailJson = (await detailRes.json()) as Record<
                  string,
                  unknown
                >;
                const normalized = normalizeZapSignDocsPayload([detailJson])[0];
                if (normalized) {
                  storeZapSignDocDetailCache(doc.token, {
                    signers: normalized.signers,
                    signedAt: normalized.signedAt,
                    folderPath: normalized.folderPath,
                    folderName: normalized.folderName,
                    signedFileUrl: normalized.signedFileUrl,
                  });
                }
              } catch {
                // ignore background fetch errors
              } finally {
                clearTimeout(timer);
              }
            }
          };
          await Promise.all(
            Array.from({ length: bgWorkers }, () => runBgWorker())
          );
          zapsignSignedListCache = null;
        } finally {
          zapsignBgWarmupRunning = false;
        }
      })();
    }
  }

  return docs.filter(
    (doc) => !isExcludedZapSignFolder(doc.folderPath, doc.folderName)
  );
}

interface ServerWorkspaceCacheEntry {
  data: EnrichedAppsScriptSyncResult;
  cachedAt: number;
  freshUntil: number;
  expiresAt: number;
}

const serverWorkspaceCache = new Map<string, ServerWorkspaceCacheEntry>();
const serverWorkspaceInFlight = new Map<
  string,
  Promise<EnrichedAppsScriptSyncResult>
>();

function resolveAllowedAppsScriptUrl(rawUrl?: string): {
  ok: true;
  url: string;
} | {
  ok: false;
  error: string;
} {
  const candidate =
    String(rawUrl ?? '').trim() ||
    String(process.env.APPS_SCRIPT_URL ?? '').trim() ||
    DEFAULT_WORKSPACE_APPS_SCRIPT_URL;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') {
      return {
        ok: false,
        error: 'URL do Google Apps Script deve utilizar HTTPS.',
      };
    }
    if (!ALLOWED_APPS_SCRIPT_HOSTS.has(parsed.hostname.toLowerCase())) {
      return {
        ok: false,
        error: 'Domínio não permitido para sincronização do Google Apps Script.',
      };
    }
    if (!parsed.pathname.startsWith('/macros/s/')) {
      return {
        ok: false,
        error: 'Caminho de implantação do Google Apps Script inválido.',
      };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: 'URL do Google Apps Script malformada.' };
  }
}

function storeServerWorkspaceCache(
  url: string,
  data: EnrichedAppsScriptSyncResult
): ServerWorkspaceCacheEntry {
  if (
    !serverWorkspaceCache.has(url) &&
    serverWorkspaceCache.size >= WORKSPACE_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = serverWorkspaceCache.keys().next().value;
    if (oldestKey) serverWorkspaceCache.delete(oldestKey);
  }
  const now = Date.now();
  const entry: ServerWorkspaceCacheEntry = {
    data,
    cachedAt: now,
    freshUntil: now + WORKSPACE_CACHE_FRESH_TTL_MS,
    expiresAt: now + WORKSPACE_CACHE_STALE_TTL_MS,
  };
  serverWorkspaceCache.set(url, entry);
  return entry;
}

async function fetchAndMapWorkspaceFromServer(
  targetUrl: string
): Promise<EnrichedAppsScriptSyncResult> {
  const existing = serverWorkspaceInFlight.get(targetUrl);
  if (existing) return existing;

  const job = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      WORKSPACE_FETCH_TIMEOUT_MS
    );
    try {
      const upstream = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!upstream.ok) {
        throw new Error(`HTTP_${upstream.status}`);
      }
      const json: unknown = await upstream.json();
      const mapped = mapAppsScriptPayload(json);
      storeServerWorkspaceCache(targetUrl, mapped);
      return mapped;
    } finally {
      clearTimeout(timer);
    }
  })();

  serverWorkspaceInFlight.set(targetUrl, job);
  try {
    return await job;
  } finally {
    serverWorkspaceInFlight.delete(targetUrl);
  }
}

function paginateWorkspaceResult(
  data: EnrichedAppsScriptSyncResult,
  rawPage: unknown,
  rawPageSize: unknown
): EnrichedAppsScriptSyncResult & {
  pagination?: {
    page: number;
    pageSize: number;
    totalClients: number;
    totalPages: number;
    hasMore: boolean;
  };
} {
  if (rawPage === undefined && rawPageSize === undefined) {
    return data;
  }
  const page = Math.max(1, Math.floor(Number(rawPage) || 1));
  const pageSize = Math.min(500, Math.max(1, Math.floor(Number(rawPageSize) || 50)));
  const totalClients = data.clients.length;
  const totalPages = Math.max(1, Math.ceil(totalClients / pageSize));
  const start = (page - 1) * pageSize;
  const pagedClients = data.clients.slice(start, start + pageSize);

  return {
    ...data,
    clients: pagedClients,
    pagination: {
      page,
      pageSize,
      totalClients,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

function loadFirebaseProjectId(): string {
  const envProjectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (envProjectId) return envProjectId;
  try {
    const raw = fs.readFileSync(
      path.resolve(__dirname, 'firebase-applet-config.json'),
      'utf8'
    );
    const parsed = JSON.parse(raw) as { projectId?: string };
    if (parsed.projectId) return parsed.projectId;
  } catch {
    // fallback below
  }
  return 'gen-lang-client-0925403191';
}

const FIREBASE_PROJECT_ID = loadFirebaseProjectId();

async function requireAuthorizedUser(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const result = await verifyFirebaseIdTokenAndAllowlist(
    req.headers.authorization,
    { projectId: FIREBASE_PROJECT_ID }
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  next();
}

function isTransientUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.toLowerCase().includes('high demand')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChatHistoryEntry {
  role: 'user' | 'model';
  text: string;
}

interface DocumentAttachmentPayload {
  nome: string;
  mimeType: string;
  formato: 'base64' | 'texto';
  conteudo: string;
}

interface AssistantChatRequestBody {
  message?: string;
  history?: ChatHistoryEntry[];
  portfolioContext?: string;
  documentAttachment?: DocumentAttachmentPayload;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Chave GEMINI_API_KEY não encontrada nas configurações do ambiente.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildContents(
  history: ChatHistoryEntry[],
  currentMessage: string,
  documentAttachment?: DocumentAttachmentPayload
): Content[] {
  const contents: Content[] = [];

  for (const item of history.slice(-16)) {
    const cleanText = String(item?.text ?? '').trim();
    if (!cleanText) continue;
    const role = item.role === 'model' ? 'model' : 'user';
    contents.push({
      role,
      parts: [{ text: cleanText }],
    });
  }

  const userParts: Part[] = [];

  if (documentAttachment && documentAttachment.conteudo) {
    if (documentAttachment.formato === 'base64') {
      userParts.push({
        inlineData: {
          mimeType: documentAttachment.mimeType || 'application/pdf',
          data: documentAttachment.conteudo,
        },
      });
      userParts.push({
        text: `${currentMessage}\n\n[Documento anexado do Google Drive: ${documentAttachment.nome} (${documentAttachment.mimeType || 'application/pdf'})]`,
      });
    } else {
      const clippedText = documentAttachment.conteudo.slice(0, 120000);
      userParts.push({
        text: `${currentMessage}\n\n--- CONTEÚDO DO DOCUMENTO (${documentAttachment.nome}) ---\n${clippedText}`,
      });
    }
  } else {
    userParts.push({ text: currentMessage });
  }

  contents.push({
    role: 'user',
    parts: userParts,
  });

  return contents;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('503_TIMEOUT')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateWithFallback(
  ai: GoogleGenAI,
  contents: Content[],
  systemInstruction: string
) {
  try {
    return await withTimeout(
      ai.models.generateContent({
        model: PRIMARY_MODEL,
        contents,
        config: { systemInstruction },
      }),
      15000
    );
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === '503_TIMEOUT';
    if (!isTimeout && !isTransientUnavailableError(err)) {
      throw err;
    }
    if (!isTimeout) {
      await sleep(400);
    }
    return await ai.models.generateContent({
      model: FALLBACK_MODEL,
      contents,
      config: { systemInstruction },
    });
  }
}

let isShuttingDown = false;

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '30mb' }));

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isShuttingDown) {
      res.status(503).json({ ok: false, status: 'shutting_down' });
      return;
    }
    res.status(200).json({
      ok: true,
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.post('/api/assistant/chat', requireAuthorizedUser, async (req, res) => {
    try {
      const body = (req.body ?? {}) as AssistantChatRequestBody;
      const message = String(body.message ?? '').trim();
      if (!message) {
        res.status(400).json({ error: 'Envie uma pergunta ou comando para o assistente.' });
        return;
      }

      const ai = getGeminiClient();
      const history = Array.isArray(body.history) ? body.history : [];
      const portfolioContext = String(body.portfolioContext ?? '').slice(0, 100000);
      const contents = buildContents(history, message, body.documentAttachment);

      const response = await generateWithFallback(
        ai,
        contents,
        buildDonaSystemPrompt(portfolioContext)
      );

      const reply = response.text?.trim();
      if (!reply) {
        res.status(502).json({
          error: 'O assistente não retornou texto para esta solicitação. Tente novamente.',
        });
        return;
      }

      res.json({ reply });
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : 'Erro inesperado ao consultar o Gemini.';
      const isMissingKey = errMsg.includes('GEMINI_API_KEY');
      const status = isMissingKey
        ? 503
        : errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')
          ? 429
          : isTransientUnavailableError(err)
            ? 503
            : errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED')
              ? 403
              : 500;

      console.error('[Dona · Barreto Flow] Erro Gemini API:', errMsg);
      res.status(status).json({
        error: isMissingKey
          ? 'A Dona está indisponível porque a chave de IA (GEMINI_API_KEY) ainda não foi configurada no ambiente do servidor.'
          : status === 429
            ? 'Limite temporário de requisições da API Gemini atingido. Aguarde alguns segundos e tente novamente.'
            : status === 503
              ? 'O serviço de IA está temporariamente sobrecarregado. Aguarde alguns segundos e tente novamente.'
              : status === 403
                ? 'Permissão negada ou chave da API Gemini inválida nas configurações do ambiente.'
                : 'A Dona não conseguiu concluir a análise neste momento. Tente novamente em instantes.',
      });
    }
  });

  app.get('/api/zapsign/signed', requireAuthorizedUser, async (req, res) => {
    const token = process.env.ZAPSIGN_API_TOKEN?.trim();
    if (!token || token === 'MY_ZAPSIGN_API_TOKEN') {
      res.json({
        configured: false,
        docs: [],
        message: 'ZAPSIGN_API_TOKEN não configurado nas variáveis do ambiente.',
      });
      return;
    }

    const forceRefresh =
      req.query.force === 'true' || req.query.force === '1';
    if (
      !forceRefresh &&
      zapsignSignedListCache &&
      Date.now() - zapsignSignedListCache.cachedAt <= ZAPSIGN_LIST_CACHE_TTL_MS
    ) {
      res.setHeader('X-Cache', 'HIT');
      res.json({
        configured: true,
        docs: zapsignSignedListCache.docs,
      });
      return;
    }

    try {
      const signedDocs: ZapSignSignedDoc[] = [];

      let nextUrl: string | null = 'https://api.zapsign.com.br/api/v1/docs/';
      let pageCount = 0;

      while (nextUrl && pageCount < 10) {
        pageCount += 1;
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          ZAPSIGN_FETCH_TIMEOUT_MS
        );
        let zapRes: Response;
        try {
          zapRes = await fetch(nextUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (!zapRes.ok) {
          const status = zapRes.status;
          res.status(status === 401 || status === 403 ? status : 502).json({
            configured: true,
            docs: [],
            error:
              status === 401 || status === 403
                ? 'Token da API ZapSign inválido ou sem permissão de leitura.'
                : `Erro ao consultar a API do ZapSign (HTTP ${status}).`,
          });
          return;
        }

        const payload = (await zapRes.json()) as
          | {
              next?: string | null;
              results?: Array<Record<string, unknown>>;
            }
          | Array<Record<string, unknown>>;

        const rawItems = Array.isArray(payload)
          ? payload
          : Array.isArray(payload.results)
            ? payload.results
            : [];

        const normalizedPage = normalizeZapSignDocsPayload(rawItems).filter(
          (doc) => !isExcludedZapSignFolder(doc.folderPath, doc.folderName)
        );
        signedDocs.push(...normalizedPage);

        nextUrl =
          !Array.isArray(payload) && typeof payload.next === 'string' && payload.next
            ? payload.next
            : null;
      }

      const enrichedDocs = await enrichZapSignDocsWithSigners(signedDocs, token);
      zapsignSignedListCache = {
        docs: enrichedDocs,
        cachedAt: Date.now(),
      };

      res.setHeader('X-Cache', 'MISS');
      res.json({
        configured: true,
        docs: enrichedDocs,
      });
    } catch (err: unknown) {
      console.error(
        '[ZapSign] Erro ao consultar documentos assinados:',
        err instanceof Error ? err.message : err
      );
      res.status(502).json({
        configured: true,
        docs: [],
        error: 'Falha de comunicação ao consultar os contratos assinados no ZapSign.',
      });
    }
  });

  app.get('/api/workspace/sync', requireAuthorizedUser, async (req, res) => {
    const rawUrl =
      typeof req.query.url === 'string' ? req.query.url : undefined;
    const validated = resolveAllowedAppsScriptUrl(rawUrl);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    const forceRefresh =
      req.query.force === 'true' || req.query.force === '1';
    const now = Date.now();
    const cached = !forceRefresh
      ? serverWorkspaceCache.get(validated.url)
      : undefined;

    if (cached && now <= cached.expiresAt) {
      const isFresh = now <= cached.freshUntil;
      if (!isFresh) {
        // Stale-while-revalidate: serve immediately and refresh in background
        void fetchAndMapWorkspaceFromServer(validated.url).catch((err) => {
          console.error(
            '[Workspace SWR] Falha na revalidação em background:',
            err instanceof Error ? err.message : err
          );
        });
      }

      const payload = paginateWorkspaceResult(
        cached.data,
        req.query.page,
        req.query.pageSize
      );
      res.setHeader('X-Cache', isFresh ? 'HIT' : 'STALE');
      res.json({
        ...payload,
        cache: {
          status: isFresh ? 'HIT' : 'STALE',
          cachedAt: new Date(cached.cachedAt).toISOString(),
          revalidating: !isFresh,
        },
      });
      return;
    }

    try {
      const fresh = await fetchAndMapWorkspaceFromServer(validated.url);
      const payload = paginateWorkspaceResult(
        fresh,
        req.query.page,
        req.query.pageSize
      );
      res.setHeader('X-Cache', 'MISS');
      res.json({
        ...payload,
        cache: {
          status: 'MISS',
          cachedAt: new Date().toISOString(),
          revalidating: false,
        },
      });
    } catch (err: unknown) {
      console.error(
        '[Workspace Sync] Erro ao sincronizar carteira:',
        err instanceof Error ? err.message : err
      );
      res.status(502).json({
        error:
          'Falha ao sincronizar a planilha e os reflexos do Google Workspace no servidor.',
      });
    }
  });

  app.post(
    '/api/workspace/cache/invalidate',
    requireAuthorizedUser,
    (req, res) => {
      const body = (req.body ?? {}) as { url?: string };
      if (typeof body.url === 'string' && body.url.trim()) {
        const validated = resolveAllowedAppsScriptUrl(body.url);
        if (!validated.ok) {
          res.status(400).json({ error: validated.error });
          return;
        }
        serverWorkspaceCache.delete(validated.url);
      } else {
        serverWorkspaceCache.clear();
      }
      res.json({ ok: true });
    }
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Rota de API não encontrada.' });
  });

  const distDir = path.resolve(__dirname, 'dist');
  const distIndexPath = path.join(distDir, 'index.html');
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (process.env.NODE_ENV !== 'development' && fs.existsSync(distIndexPath));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (
            filePath.includes(`${path.sep}assets${path.sep}`) ||
            filePath.includes('/assets/')
          ) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      if (!fs.existsSync(distIndexPath)) {
        res
          .status(503)
          .type('text/plain; charset=utf-8')
          .send('Interface de produção indisponível no momento.');
        return;
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(distIndexPath);
    });
  }

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status =
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        typeof (err as { status?: unknown }).status === 'number'
          ? (err as { status: number }).status
          : 500;
      const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
      console.error(`[Barreto Flow] Erro HTTP ${status}:`, msg);
      if (res.headersSent) return;
      res.status(status >= 400 && status < 600 ? status : 500).json({
        error:
          status === 400 || status === 413
            ? 'Requisição inválida ou payload excede o limite suportado.'
            : 'Erro interno temporário no servidor. Tente novamente em instantes.',
      });
    }
  );

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Barreto Flow server running on http://0.0.0.0:${PORT} (mode=${isProduction ? 'production' : 'development'})`
    );
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error('[Barreto Flow] Falha fatal ao escutar porta:', err.message);
    process.exit(1);
  });

  const gracefulShutdown = (signal: string, exitCode = 0) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(
      `[Barreto Flow] Recebido ${signal}. Encerrando servidor com segurança...`
    );
    const forceTimer = setTimeout(() => {
      console.error(
        '[Barreto Flow] Tempo limite de encerramento gracioso atingido. Finalizando processo.'
      );
      process.exit(exitCode || 1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    server.close((closeErr) => {
      clearTimeout(forceTimer);
      if (closeErr) {
        console.error('[Barreto Flow] Erro ao fechar conexões HTTP:', closeErr.message);
        process.exit(1);
      }
      console.log('[Barreto Flow] Servidor encerrado com sucesso.');
      process.exit(exitCode);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0));
  process.on('SIGINT', () => gracefulShutdown('SIGINT', 0));
  process.on('unhandledRejection', (reason) => {
    console.error(
      '[Barreto Flow] Unhandled Promise Rejection capturada:',
      reason instanceof Error ? reason.stack || reason.message : reason
    );
  });
  process.on('uncaughtException', (err) => {
    console.error(
      '[Barreto Flow] Uncaught Exception capturada:',
      err.stack || err.message
    );
    gracefulShutdown('uncaughtException', 1);
  });
}

startServer().catch((err) => {
  console.error('[Barreto Flow] Falha ao iniciar servidor:', err);
  process.exit(1);
});
