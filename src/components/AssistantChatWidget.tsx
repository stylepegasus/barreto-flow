import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Loader2,
  MessageSquare,
  RotateCcw,
  Send,
  Sparkles,
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
  ASSISTANT_NAME,
  AssistantContextExtras,
  buildDocumentAnalysisPrompt,
  buildPortfolioContextSummary,
  findDocumentReferenceInQuery,
  getActiveTabLabel,
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
    id: 'resumo-mes',
    label: 'Resumo do mês',
    prompt:
      'Faça um resumo executivo do mês em análise com base nos dados carregados: previsto, recebido, saldo total a receber, taxa de adimplência e principais pontos de atenção.',
  },
  {
    id: 'atrasos-vencimentos',
    label: 'Atrasos e próximos vencimentos',
    prompt:
      'Quais parcelas estão em atraso, vencem hoje ou nos próximos 7 dias? Liste cliente, número da parcela, valor, vencimento e ordem de prioridade.',
  },
  {
    id: 'visao-carteira',
    label: 'Visão geral da carteira',
    prompt:
      'Apresente uma visão geral dos clientes e honorários da carteira atual: distribuição por etapa do Drive, maiores saldos em aberto e clientes que merecem acompanhamento.',
  },
  {
    id: 'whatsapp-pix',
    label: 'Mensagem WhatsApp (PIX)',
    prompt:
      'Gere mensagens prontas e cordiais de cobrança para WhatsApp para as clientes em atraso ou com vencimento hoje, incluindo a chave PIX barretoadvocacia01@gmail.com.',
  },
  {
    id: 'simular-meta-roi',
    label: 'Meta e ROI do mês',
    prompt:
      'Compare a meta do mês atual com o Previsto e Recebido na planilha e com os parâmetros do Simulador de Tráfego Pago (investimento, CPL, conversão, ticket médio, inadimplência e ROI). Indique quantos contratos faltam para bater a meta.',
  },
  {
    id: 'auditar-zapsign',
    label: 'Auditar ZapSign × Planilha',
    prompt:
      'Faça uma auditoria cruzando os contratos assinados no ZapSign com os clientes e parcelas da planilha. Liste quais contratos assinados ainda não foram cadastrados ou estão sem parcelas confirmadas.',
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

function DonaMonogram({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const boxClass = size === 'sm' ? 'h-8 w-8 text-sm' : 'h-9 w-9 text-base';
  return (
    <span
      aria-hidden="true"
      className={`flex ${boxClass} shrink-0 items-center justify-center rounded-lg border border-[#DCB14A]/75 bg-[#DCB14A]/15 font-serif font-bold text-[#FFD559]`}
    >
      D
    </span>
  );
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
  const [showQuickActions, setShowQuickActions] = useState(true);

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

  const activeViewShortLabel = useMemo(() => {
    const label = getActiveTabLabel(contextExtras?.activeTab);
    return label.split(' (')[0];
  }, [contextExtras?.activeTab]);

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
            `Não foi possível obter resposta da ${ASSISTANT_NAME} neste momento. Verifique se o serviço de IA está configurado e tente novamente.`
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
          : `Erro ao consultar a ${ASSISTANT_NAME}. Tente novamente em instantes.`;
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

  const handleResetConversation = () => {
    onMessagesChange([]);
    setErrorMessage(null);
    setShowQuickActions(true);
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
          aria-label={`Abrir chat com a ${ASSISTANT_NAME} (Assistente do Barreto Flow)`}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2.5 rounded-xl border border-[#DCB14A]/65 bg-[#313131] px-4 py-3 text-left text-white shadow-lg transition-transform hover:-translate-y-0.5 hover:bg-[#313131]/95 focus:outline-none focus:ring-2 focus:ring-[#DCB14A]"
        >
          <DonaMonogram size="sm" />
          <span className="leading-tight">
            <span className="block font-serif text-sm font-bold text-white">
              {ASSISTANT_NAME}
            </span>
            <span className="block text-[10px] font-medium tracking-wide text-[#DCB14A]">
              Assistente Barreto Flow
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
            aria-modal="true"
            aria-label={`${ASSISTANT_NAME} — Assistente Operacional e Financeira`}
            data-testid="assistant-drawer"
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-[440px] flex-col border-l border-[#313131]/15 bg-[#F6F3EC] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#313131] px-5 py-4 text-white">
              <div className="flex items-center gap-3 min-w-0">
                <DonaMonogram size="md" />
                <div className="min-w-0">
                  <h2 className="font-serif text-base font-bold text-white truncate">
                    {ASSISTANT_NAME}
                  </h2>
                  <p className="text-[11px] font-medium text-[#DCB14A] truncate">
                    Assistente Barreto Flow · Somente Leitura
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={handleResetConversation}
                    disabled={Boolean(loadingStage)}
                    title="Limpar e reiniciar conversa"
                    aria-label="Limpar e reiniciar conversa com a Dona"
                    className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] font-medium text-[#F6F3EC]/80 hover:border-[#DCB14A]/50 hover:bg-white/10 hover:text-white disabled:opacity-45"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Nova conversa</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label="Fechar chat da Dona"
                  className="rounded-md p-1.5 text-[#F6F3EC]/80 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Context Summary Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#313131]/10 bg-white px-5 py-2 text-[11px] text-[#313131]/70 tabular-nums">
              <span className="truncate">
                Sessão:{' '}
                <strong className="text-[#313131]">{activeViewShortLabel}</strong>
                {' · '}
                <strong className="text-[#313131]">{clients.length}</strong>{' '}
                cliente(s)
              </span>
              <span className="shrink-0">
                <strong className="text-[#313131]">{totalDriveFiles}</strong>{' '}
                doc(s) no Drive
              </span>
            </div>

            {/* Messages Thread */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 ? (
                <div className="rounded-xl border border-[#313131]/12 bg-white p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#8D6A14]">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Olá! Sou a {ASSISTANT_NAME}, assistente do Barreto Flow.
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[#313131]/80">
                    Acompanho a carteira carregada nesta sessão — honorários,
                    parcelas em aberto ou atrasadas, vencimentos, metas,
                    auditoria ZapSign e documentos do Google Drive — sempre em{' '}
                    <strong className="text-[#313131]">modo somente leitura</strong>{' '}
                    e sem inventar dados fora do painel.
                  </p>
                  <p className="text-xs leading-relaxed text-[#313131]/75">
                    Escolha uma sugestão rápida abaixo, pergunte sobre qualquer
                    cliente ou clique em{' '}
                    <strong className="text-[#313131]">Analisar com a Dona</strong>{' '}
                    em <em>Clientes &amp; Processos</em> para leitura de contratos
                    e decisões.
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
                      {msg.role === 'model' && (
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8D6A14]">
                          {ASSISTANT_NAME}
                        </p>
                      )}

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
                <div className="flex items-start" role="status" aria-live="polite">
                  <div className="inline-flex items-center gap-2 rounded-xl border border-[#DCB14A]/50 bg-white px-4 py-2.5 text-xs text-[#313131]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#8D6A14]" />
                    <span>
                      {loadingStage === 'reading_drive'
                        ? `${ASSISTANT_NAME} está lendo o documento no Google Drive...`
                        : `${ASSISTANT_NAME} está analisando a carteira...`}
                    </span>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div
                  role="alert"
                  className="flex items-start justify-between gap-2.5 rounded-xl border border-red-700/25 bg-red-50 px-3.5 py-2.5 text-xs text-red-900"
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700" />
                    <p className="leading-relaxed">{errorMessage}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorMessage(null)}
                    aria-label="Fechar aviso de erro"
                    className="rounded p-0.5 text-red-800/70 hover:bg-red-100 hover:text-red-950 shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Action Shortcuts */}
            <div className="border-t border-[#313131]/10 bg-white/85 px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#313131]/55">
                  Sugestões rápidas
                </p>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowQuickActions((prev) => !prev)}
                    aria-expanded={showQuickActions}
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-[#8D6A14] hover:text-[#313131]"
                  >
                    <span>{showQuickActions ? 'Ocultar' : 'Mostrar'}</span>
                    {showQuickActions ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronUp className="h-3 w-3" />
                    )}
                  </button>
                )}
              </div>

              {(messages.length === 0 || showQuickActions) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
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
              )}
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
                  placeholder={`Pergunte à ${ASSISTANT_NAME} sobre honorários, parcelas, vencimentos ou documentos...`}
                  aria-label={`Mensagem para a ${ASSISTANT_NAME}`}
                  className="flex-1 resize-none rounded-lg border border-[#313131]/20 bg-[#F6F3EC] px-3 py-2 text-xs text-[#313131] placeholder:text-[#313131]/45 focus:border-[#DCB14A] focus:bg-white focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!inputValue.trim() || Boolean(loadingStage)}
                  aria-label={`Enviar mensagem para a ${ASSISTANT_NAME}`}
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
