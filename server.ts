import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import type { Content, Part } from '@google/genai';
import { verifyFirebaseIdTokenAndAllowlist } from './src/utils/serverAuth.ts';

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

function buildSystemInstruction(portfolioContext: string): string {
  return [
    'Você é Mike Ross, o Assistente Barreto da Barreto Advocacia Especializada (especializada em Direito de Família).',
    'Atue como um assistente jurídico-financeiro ágil, preciso, claro e cordial, falando em português do Brasil (pt-BR), sem jargões técnicos desnecessários.',
    '',
    'REGRAS IMPORTANTES:',
    '1. O sistema está operando em MODO SOMENTE LEITURA. Nunca afirme que já alterou a planilha oficial ou o Google Calendar; em vez disso, indique com clareza quais linhas/colunas da planilha ou evento na agenda (horário padrão 13h30 às 14h30) devem ser atualizados pela equipe.',
    '2. Ao gerar mensagens de cobrança para WhatsApp, mantenha tom humano, respeitoso e firme na medida certa, e inclua a chave PIX oficial do escritório: barretoadvocacia01@gmail.com quando aplicável.',
    '3. Ao analisar contratos, procurações, decisões ou protocolos anexados, extraia objetivamente em tópicos:',
    '   - Número do processo e objeto do contrato / tipo de ação;',
    '   - Datas importantes (assinatura, protocolo, decisão, audiência ou prazos);',
    '   - Valores de honorários (total contratado, entrada, parcelas e percentual de êxito);',
    '   - Regras de vencimento e forma de pagamento;',
    '   - Sugestões práticas do que atualizar na planilha "Barreto — Honorários (Ads Família)" ou na agenda.',
    '4. Quando o usuário perguntar sobre metas, projeções ou ROI de Tráfego Pago, compare a meta do mês com o Previsto/Recebido na planilha e os dados do Simulador (investimento, CPL, conversão, ticket médio, inadimplência e ROI), calculando quantos contratos ainda faltam fechar para bater a meta.',
    '5. Quando o usuário pedir auditoria ZapSign × Planilha, cruze os documentos assinados do ZapSign recebidos no contexto com os clientes e parcelas da planilha, destacando exatamente quem assinou no ZapSign mas ainda falta cadastrar na planilha ou está sem parcelas confirmadas.',
    '6. Responda de forma bem estruturada, concisa e com valores sempre formatados em R$ (padrão brasileiro) e datas em DD/MM/AAAA.',
    '',
    portfolioContext
      ? `CONTEXTO ATUAL DA CARTEIRA CARREGADA NO PAINEL:\n${portfolioContext}`
      : 'Nenhum dado adicional da carteira foi enviado nesta chamada.',
  ].join('\n');
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
        buildSystemInstruction(portfolioContext)
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
      const status =
        errMsg.includes('GEMINI_API_KEY')
          ? 500
          : errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')
            ? 429
            : isTransientUnavailableError(err)
              ? 503
              : errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED')
                ? 403
                : 500;

      console.error('[Assistente Barreto] Erro Gemini API:', errMsg);
      res.status(status).json({
        error:
          status === 429
            ? 'Limite temporário de requisições da API Gemini atingido. Aguarde alguns segundos e tente novamente.'
            : status === 503
              ? 'O modelo de IA está temporariamente sobrecarregado. Aguarde alguns segundos e tente novamente.'
              : status === 403
                ? 'Permissão negada ou chave da API Gemini inválida nas configurações do projeto.'
                : 'Não foi possível concluir a análise com a IA neste momento. Tente novamente em instantes.',
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
      const signedDocs: Array<{
        token: string;
        name: string;
        status: 'signed';
        createdAt: string;
        signedAt: string;
        signedFileUrl?: string;
        signers: Array<{
          name: string;
          email?: string;
          phone?: string;
          signedAt?: string;
        }>;
      }> = [];

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

        for (const item of rawItems) {
          const docStatus = String(item.status ?? '')
            .trim()
            .toLowerCase();
          if (docStatus !== 'signed') continue;

          const docToken = String(item.token ?? '').trim();
          const docName = String(item.name ?? '').trim();
          if (!docToken || !docName) continue;

          const rawSigners = Array.isArray(item.signers)
            ? (item.signers as Array<Record<string, unknown>>)
            : [];

          const signers = rawSigners
            .map((s) => {
              const phoneNum = String(s.phone_number ?? '').trim();
              const phoneCountry = String(s.phone_country ?? '').replace(/\D/g, '');
              const phone = phoneNum
                ? phoneCountry
                  ? `+${phoneCountry} ${phoneNum}`
                  : phoneNum
                : undefined;
              return {
                name: String(s.name ?? '').trim(),
                email: String(s.email ?? '').trim() || undefined,
                phone,
                signedAt: String(s.signed_at ?? '').trim() || undefined,
              };
            })
            .filter((s) => Boolean(s.name));

          const latestSignerDate = signers
            .map((s) => s.signedAt)
            .filter((d): d is string => Boolean(d))
            .sort()
            .pop();

          const createdAt = String(item.created_at ?? '').trim();
          const signedAt =
            latestSignerDate ||
            String(item.last_update_at ?? '').trim() ||
            createdAt;
          const signedFileUrl =
            String(item.signed_file ?? '').trim() || undefined;

          signedDocs.push({
            token: docToken,
            name: docName,
            status: 'signed',
            createdAt,
            signedAt,
            signedFileUrl,
            signers,
          });
        }

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
