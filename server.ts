import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import type { Content, Part } from '@google/genai';
import { verifyFirebaseIdTokenAndAllowlist } from './src/utils/serverAuth.ts';
import { buildDonaSystemPrompt } from './src/utils/assistantContext.ts';
import {
  isExcludedZapSignFolder,
  normalizeZapSignDocsPayload,
} from './src/utils/zapsignLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function loadFirebaseProjectId(): string {
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
  return process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0925403191';
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ ok: true });
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

  app.get('/api/zapsign/signed', requireAuthorizedUser, async (_req, res) => {
    const token = process.env.ZAPSIGN_API_TOKEN?.trim();
    if (!token || token === 'MY_ZAPSIGN_API_TOKEN') {
      res.json({
        configured: false,
        docs: [],
        message: 'ZAPSIGN_API_TOKEN não configurado nas variáveis do ambiente.',
      });
      return;
    }

    try {
      const signedDocs: ReturnType<typeof normalizeZapSignDocsPayload> = [];

      let nextUrl: string | null = 'https://api.zapsign.com.br/api/v1/docs/';
      let pageCount = 0;

      while (nextUrl && pageCount < 10) {
        pageCount += 1;
        const zapRes = await fetch(nextUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

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

      res.json({
        configured: true,
        docs: signedDocs,
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
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(distIndexPath);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Barreto Advocacia server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
