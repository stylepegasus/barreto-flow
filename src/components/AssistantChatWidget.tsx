import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FileText,
  Loader2,
  MessageSquare,
  Scale,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  AppsScriptCalendarEventRow,
  ChatMessage,
  ClientCase,
  DriveFileItem,
} from '../types/honorarios';
import { fetchDriveFileContent } from '../services/googleWorkspace';
import { getFirebaseIdToken } from '../services/googleAuth';
import {
  AssistantContextExtras,
  buildDocumentAnalysisPrompt,
  buildPortfolioContextSummary,
  findDocumentReferenceInQuery,
} from '../utils/assistantContext';

export interface PendingDocumentAnalysisRequest {
  requestId: string;
  client: ClientCase;
  file: DriveFileItem;
}

interface AssistantChatWidgetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  messages: ChatMessage[];
  onMessagesChange: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  clients: ClientCase[];
  calendarEvents: AppsScriptCalendarEventRow[];
  todayISO: string;
  appsScriptUrl: string;
  contextExtras?: AssistantContextExtras;
  pendingDocumentRequest: PendingDocumentAnalysisRequest | null;
  onClearPendingDocumentRequest: () => void;
}

const QUICK_ACTIONS = [
  {
    id: 'cobrar-hoje',
    label: 'Quem cobrar hoje?',
    prompt:
      'Quem devemos cobrar hoje? Liste as clientes em atraso e com vencimento na data de hoje, informando parcela, valor e telefone.',
  },
  {
    id: 'resumo-inadimplentes',
    label: 'Resumo de inadimplentes',
    prompt:
      'Faça um resumo executivo das clientes inadimplentes (em atraso), indicando valores em aberto e prioridades de cobrança.',
  },
  {
    id: 'whatsapp-pix',
    label: 'Gerar mensagem WhatsApp (PIX)',
    prompt:
      'Gere mensagens prontas de cobrança para WhatsApp para as clientes em atraso ou com vencimento hoje, incluindo a chave PIX barretoadvocacia01@gmail.com.',
  },
  {
    id: 'simular-meta-roi',
    label: 'Simular meta e ROI do mês',
    prompt:
      'Analise a meta do mês atual comparando o Previsto e Recebido na planilha com os parâmetros atuais do Simulador de Tráfego Pago (investimento, CPL, conversão, ticket médio, inadimplência e ROI). Diga se a meta será batida e quantos contratos ainda faltam fechar.',
  },
  {
    id: 'auditar-zapsign',
    label: 'Auditar ZapSign × Planilha',
    prompt:
      'Faça uma auditoria cruzando os contratos assinados no ZapSign com os clientes e parcelas da planilha. Liste quais contratos assinados ainda não foram cadastrados na planilha ou estão sem parcelas confirmadas.',
  },
] as const;

function renderInlineBold(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-[#313131]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const AssistantChatWidget: React.FC<AssistantChatWidgetProps> = ({
  isOpen,
  onOpenChange,
  messages,
  onMessagesChange,
  clients,
  calendarEvents,
  todayISO,
  appsScriptUrl,
  contextExtras,
  pendingDocumentRequest,
  onClearPendingDocumentRequest,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [loadingStage, setLoadingStage] = useState<
    null | 'reading_drive' | 'thinking'
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const handledRequestIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;

  const portfolioContext = useMemo(
    () =>
      buildPortfolioContextSummary(
        clients,
        calendarEvents,
        todayISO,
        contextExtras
      ),
    [clients, calendarEvents, todayISO, contextExtras]
  );

  const totalDriveFiles = useMemo(
    () => clients.reduce((sum, c) => sum + (c.driveFiles?.length ?? 0), 0),
    [clients]
  );

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [isOpen, messages.length, loadingStage]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onOpenChange]);

  const sendMessageToAssistant = async (
    rawPrompt: string,
    explicitDoc?: { client: ClientCase; file: DriveFileItem }
  ) => {
    const trimmed = rawPrompt.trim();
    if (!trimmed || loadingStage) return;

    setErrorMessage(null);
    const detectedDoc =
      explicitDoc ?? findDocumentReferenceInQuery(trimmed, clients) ?? undefined;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
      attachedDocument: detectedDoc
        ? {
            fileId: detectedDoc.file.id,
            fileName: detectedDoc.file.nome,
            clientName: detectedDoc.client.fullName,
            mimeType: detectedDoc.file.mimeType,
          }
        : undefined,
    };

    const historySnapshot = messagesRef.current.map((m) => ({
      role: m.role,
      text: m.text,
    }));

    onMessagesChange((prev) => [...prev, userMsg]);

    try {
      let documentAttachment:
        | {
            nome: string;
            mimeType: string;
            formato: 'base64' | 'texto';
            conteudo: string;
          }
        | undefined;

      if (detectedDoc) {
        setLoadingStage('reading_drive');
        const fileData = await fetchDriveFileContent(
          appsScriptUrl,
          detectedDoc.file.id
        );
        documentAttachment = fileData;
      }

      setLoadingStage('thinking');
      const idToken = await getFirebaseIdToken();
      if (!idToken) {
        throw new Error(
          'Sua sessão expirou. Faça login novamente com uma conta Google autorizada.'
        );
      }

      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          message: trimmed,
          history: historySnapshot,
          portfolioContext,
          documentAttachment,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };

      if (!res.ok || !payload.reply) {
        throw new Error(
          payload.error ||
            'Não foi possível obter resposta do Assistente Barreto neste momento.'
        );
      }

      const modelMsg: ChatMessage = {
        id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'model',
        text: payload.reply,
        createdAt: new Date().toISOString(),
      };

      onMessagesChange((prev) => [...prev, modelMsg]);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Erro ao consultar o assistente Mike Ross.';
      setErrorMessage(msg);
    } finally {
      setLoadingStage(null);
    }
  };

  useEffect(() => {
    if (!pendingDocumentRequest) return;
    if (handledRequestIdsRef.current.has(pendingDocumentRequest.requestId)) {
      return;
    }
    handledRequestIdsRef.current.add(pendingDocumentRequest.requestId);
    const { client, file } = pendingDocumentRequest;
    onClearPendingDocumentRequest();
    const prompt = buildDocumentAnalysisPrompt(client.fullName, file.nome);
    void sendMessageToAssistant(prompt, { client, file });
  }, [pendingDocumentRequest]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || loadingStage) return;
    const text = inputValue;
    setInputValue('');
    void sendMessageToAssistant(text);
  };

  const handleCopyReply = async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(msgId);
      setTimeout(() => {
        setCopiedId((curr) => (curr === msgId ? null : curr));
      }, 2200);
    } catch {
      // ignore clipboard error
    }
  };

  return (
    <>
      {/* Floating Launcher Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          data-testid="assistant-fab"
          aria-label="Abrir chat com Mike Ross (Assistente Barreto)"
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2.5 rounded-xl border border-[#DCB14A]/60 bg-[#313131] px-4 py-3 text-left text-white shadow-lg transition-transform hover:-translate-y-0.5 hover:bg-[#313131]/95 focus:outline-none focus:ring-2 focus:ring-[#DCB14A]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#DCB14A]/70 bg-[#DCB14A]/15 text-[#FFD559] shrink-0">
            <Scale className="h-4 w-4" />
          </span>
          <span className="leading-tight">
            <span className="block font-serif text-sm font-bold text-white">
              Mike Ross
            </span>
            <span className="block text-[10px] font-medium tracking-wide text-[#DCB14A]">
              Assistente Barreto
            </span>
          </span>
        </button>
      )}

      {/* Lateral Chat Drawer */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-[#313131]/35"
          onClick={() => onOpenChange(false)}
        >
          <aside
            role="dialog"
            aria-label="Mike Ross — Assistente Barreto"
            data-testid="assistant-drawer"
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-[440px] flex-col border-l border-[#313131]/15 bg-[#F6F3EC] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#313131] px-5 py-4 text-white">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#DCB14A]/70 bg-[#DCB14A]/15 text-[#FFD559]">
                  <Scale className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-serif text-base font-bold text-white truncate">
                    Mike Ross
                  </h2>
                  <p className="text-[11px] font-medium text-[#DCB14A] truncate">
                    Assistente Barreto · Somente Leitura
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onMessagesChange([]);
                      setErrorMessage(null);
                    }}
                    title="Limpar histórico da conversa"
                    aria-label="Limpar histórico da conversa"
                    className="rounded-md p-1.5 text-[#F6F3EC]/70 hover:bg-white/10 hover:text-white"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label="Fechar chat"
                  className="rounded-md p-1.5 text-[#F6F3EC]/80 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Context Summary Strip */}
            <div className="flex items-center justify-between border-b border-[#313131]/10 bg-white px-5 py-2 text-[11px] text-[#313131]/70 tabular-nums">
              <span>
                Carteira conectada: <strong className="text-[#313131]">{clients.length}</strong> cliente(s)
              </span>
              <span>
                <strong className="text-[#313131]">{totalDriveFiles}</strong> documento(s) no Drive
              </span>
            </div>

            {/* Messages Thread */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 ? (
                <div className="rounded-xl border border-[#313131]/12 bg-white p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#8D6A14]">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Olá! Sou Mike Ross, Assistente Barreto.</span>
                  </div>
                  <p className="text-xs leading-relaxed text-[#313131]/80">
                    Já estou conectado aos dados carregados no painel (clientes,
                    parcelas em aberto, agenda e arquivos listados no Drive).
                  </p>
                  <p className="text-xs leading-relaxed text-[#313131]/75">
                    Você pode usar os atalhos abaixo, perguntar sobre qualquer
                    cliente ou clicar em{' '}
                    <strong className="text-[#313131]">Analisar com IA</strong>{' '}
                    nos documentos em <em>Clientes &amp; Processos</em> para eu
                    ler contratos, decisões e protocolos em PDF ou texto.
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[92%] rounded-xl px-4 py-3 text-xs leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#313131] text-white'
                          : 'border border-[#313131]/12 bg-white text-[#313131]'
                      }`}
                    >
                      {msg.attachedDocument && (
                        <div className="mb-2 flex items-center gap-1.5 rounded-md border border-[#DCB14A]/45 bg-[#DCB14A]/15 px-2.5 py-1 text-[11px] text-[#FFD559]">
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {msg.attachedDocument.fileName}
                          </span>
                        </div>
                      )}

                      <div className="whitespace-pre-wrap break-words space-y-1.5">
                        {msg.role === 'model'
                          ? renderInlineBold(msg.text)
                          : msg.text}
                      </div>

                      {msg.role === 'model' && (
                        <div className="mt-2.5 flex justify-end border-t border-[#313131]/10 pt-2">
                          <button
                            type="button"
                            onClick={() => handleCopyReply(msg.id, msg.text)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#313131]/65 hover:text-[#313131]"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-700" />
                                Copiado
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 text-[#8D6A14]" />
                                Copiar resposta
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {loadingStage && (
                <div className="flex items-start">
                  <div className="inline-flex items-center gap-2 rounded-xl border border-[#DCB14A]/50 bg-white px-4 py-2.5 text-xs text-[#313131]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#8D6A14]" />
                    <span>
                      {loadingStage === 'reading_drive'
                        ? 'Lendo documento no Google Drive...'
                        : 'Mike Ross está analisando...'}
                    </span>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-700/25 bg-red-50 px-3.5 py-2.5 text-xs text-red-900"
                >
                  {errorMessage}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Action Shortcuts */}
            <div className="border-t border-[#313131]/10 bg-white/80 px-4 pt-3 pb-2">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#313131]/55">
                Ações rápidas
              </p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={Boolean(loadingStage)}
                    onClick={() => void sendMessageToAssistant(action.prompt)}
                    className="inline-flex items-center gap-1 rounded-md border border-[#313131]/20 bg-[#F6F3EC] px-2.5 py-1.5 text-[11px] font-medium text-[#313131] hover:border-[#DCB14A] hover:bg-white disabled:opacity-50"
                  >
                    <MessageSquare className="h-3 w-3 text-[#8D6A14] shrink-0" />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Composer */}
            <form
              onSubmit={handleSubmit}
              className="border-t border-[#313131]/10 bg-white p-3"
            >
              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (inputValue.trim() && !loadingStage) {
                        const text = inputValue;
                        setInputValue('');
                        void sendMessageToAssistant(text);
                      }
                    }
                  }}
                  placeholder="Pergunte sobre cobranças, parcelas ou peça para analisar um documento..."
                  aria-label="Mensagem para Mike Ross"
                  className="flex-1 resize-none rounded-lg border border-[#313131]/20 bg-[#F6F3EC] px-3 py-2 text-xs text-[#313131] placeholder:text-[#313131]/45 focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!inputValue.trim() || Boolean(loadingStage)}
                  aria-label="Enviar mensagem"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#313131] text-[#FFD559] hover:bg-[#313131]/90 disabled:opacity-45"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
};
