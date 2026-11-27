import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileSignature,
  FolderOpen,
  MessageCircle,
  Receipt,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  UserPlus,
  Wallet,
} from 'lucide-react';
import {
  AppsScriptDashboardSnapshot,
  AppsScriptPaymentRow,
  ClientCase,
  InstallmentWithStatus,
  ZapSignCrossReferenceItem,
  ZapSignSignedDoc,
} from '../types/honorarios';
import type {
  PortfolioHealthReport,
  RowParseIssue,
} from '../utils/appsScriptMapper';
import {
  calculateDashboardKPIs,
  calculateMonthlyChartData,
  formatCurrencyBRL,
  formatCurrencyCompactBRL,
  formatDateBR,
  getAttentionTodayList,
  getAvailableMonthOptions,
} from '../utils/honorariosLogic';
import {
  extractPrimarySignerName,
  formatZapSignDateBR,
} from '../utils/zapsignLogic';

interface DashboardViewProps {
  clients: ClientCase[];
  todayISO: string;
  officialDashboard?: AppsScriptDashboardSnapshot | null;
  payments?: AppsScriptPaymentRow[];
  unmatchedZapSignDocs?: ZapSignSignedDoc[];
  unmatchedZapSignItems?: ZapSignCrossReferenceItem[];
  proceduralZapSignCount?: number;
  zapSignSignedCount?: number;
  healthReport?: PortfolioHealthReport | null;
  parseIssues?: RowParseIssue[];
  isSyncing?: boolean;
  isRevalidatingSWR?: boolean;
  onRefreshPortfolio?: () => void;
  onMarkPaid: (item: InstallmentWithStatus) => void;
  onOpenWhatsApp: (item: InstallmentWithStatus) => void;
  onNavigateTab: (tab: 'calendario' | 'clientes' | 'metas') => void;
  onSelectedMonthChange?: (monthKey: string) => void;
  onPrefillZapSignItem?: (item: ZapSignCrossReferenceItem) => void;
}

interface KpiInfoTooltipProps {
  id: string;
  title: string;
  description: string;
  isOpen: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}

const KpiInfoTooltip: React.FC<KpiInfoTooltipProps> = ({
  id,
  title,
  description,
  isOpen,
  onToggle,
  onOpen,
  onClose,
}) => {
  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => onOpen(id)}
      onMouseLeave={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(id);
        }}
        onFocus={() => onOpen(id)}
        aria-expanded={isOpen}
        aria-label={`O que mede ${title}?`}
        title={`Explicação: ${title}`}
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none transition-colors focus-visible:outline-2 focus-visible:outline-[#DCB14A] ${
          isOpen
            ? 'border-[#DCB14A] bg-[#DCB14A]/25 text-[#313131]'
            : 'border-[#313131]/30 bg-[#F6F3EC] text-[#313131] hover:border-[#DCB14A] hover:bg-[#DCB14A]/25'
        }`}
      >
        !
      </button>

      {isOpen && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-2 w-64 rounded-lg border border-[#DCB14A]/50 bg-[#313131] p-3 text-left text-[11px] leading-relaxed text-[#F6F3EC] shadow-xl"
        >
          <p className="font-semibold text-[#FFD559]">{title}</p>
          <p className="mt-1 text-[#F6F3EC]/90">{description}</p>
        </div>
      )}
    </div>
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  clients,
  todayISO,
  officialDashboard,
  payments = [],
  unmatchedZapSignDocs = [],
  unmatchedZapSignItems,
  proceduralZapSignCount = 0,
  healthReport,
  parseIssues = [],
  isSyncing = false,
  isRevalidatingSWR = false,
  onRefreshPortfolio,
  onMarkPaid,
  onOpenWhatsApp,
  onNavigateTab,
  onSelectedMonthChange,
  onPrefillZapSignItem,
}) => {
  const defaultMonthKey = todayISO.slice(0, 7);
  const [selectedMonthKey, setSelectedMonthKey] =
    useState<string>(defaultMonthKey);

  useEffect(() => {
    onSelectedMonthChange?.(selectedMonthKey);
  }, [selectedMonthKey, onSelectedMonthChange]);
  const [hoveredMonthKey, setHoveredMonthKey] = useState<string | null>(null);
  const [hoveredTooltipId, setHoveredTooltipId] = useState<string | null>(null);
  const [pinnedTooltipId, setPinnedTooltipId] = useState<string | null>(null);
  const [zapSignExpanded, setZapSignExpanded] = useState(false);
  const [integrityExpanded, setIntegrityExpanded] = useState(false);

  const effectiveParseIssues =
    parseIssues.length > 0 ? parseIssues : (healthReport?.parseIssues ?? []);
  const missingDriveCount = healthReport?.missingDriveCount ?? 0;
  const missingCalendarEventsCount =
    healthReport?.missingCalendarEventsCount ?? 0;
  const clientsWithWarningsCount = healthReport?.clientsWithWarningsCount ?? 0;
  const hasIntegrityAlerts =
    effectiveParseIssues.length > 0 || clientsWithWarningsCount > 0;

  const auditItems: ZapSignCrossReferenceItem[] = useMemo(() => {
    if (unmatchedZapSignItems) return unmatchedZapSignItems;
    return unmatchedZapSignDocs.map((doc) => ({
      doc,
      primarySignerName: extractPrimarySignerName(doc),
      auditStatus: 'missing_in_spreadsheet',
      inSpreadsheet: false,
    }));
  }, [unmatchedZapSignItems, unmatchedZapSignDocs]);

  const openTooltipId = pinnedTooltipId ?? hoveredTooltipId;

  const monthOptions = useMemo(
    () => getAvailableMonthOptions(clients, todayISO, payments),
    [clients, todayISO, payments]
  );

  useEffect(() => {
    if (!pinnedTooltipId && !hoveredTooltipId) return;
    const handleDocClick = () => {
      setPinnedTooltipId(null);
      setHoveredTooltipId(null);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinnedTooltipId(null);
        setHoveredTooltipId(null);
      }
    };
    document.addEventListener('click', handleDocClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('click', handleDocClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [pinnedTooltipId, hoveredTooltipId]);

  const [refYear, refMonth] = selectedMonthKey.split('-').map(Number);
  const kpis = calculateDashboardKPIs(clients, todayISO, selectedMonthKey, {
    officialDashboard,
    payments,
  });
  const chartData = calculateMonthlyChartData(
    clients,
    refYear,
    refMonth,
    payments
  );
  const attentionList = getAttentionTodayList(clients, todayISO);

  const selectedMonthLabel =
    monthOptions.find((m) => m.monthKey === selectedMonthKey)?.label ??
    selectedMonthKey;
  const isCurrentMonth = selectedMonthKey === defaultMonthKey;

  const maxChartValue = Math.max(
    1000,
    ...chartData.map((d) => Math.max(d.previsto, d.recebido))
  );

  const activePoint =
    chartData.find((p) => p.monthKey === hoveredMonthKey) ??
    chartData.find((p) => p.monthKey === selectedMonthKey) ??
    chartData[chartData.length - 1];

  const handleToggleTooltip = (id: string) => {
    setPinnedTooltipId((prev) => (prev === id ? null : id));
  };

  const handleCloseHoverTooltip = () => {
    setHoveredTooltipId(null);
  };

  return (
    <div className="space-y-8">
      {/* Page Header + Month/Year Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[#313131]/12 pb-5">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#313131]">
            Visão Geral dos Honorários
          </h1>
          <p className="mt-1.5 text-sm text-[#313131]/70">
            Acompanhamento diário de recebimentos, atrasos e cobranças do
            escritório.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <label
              htmlFor="dashboard-month-select"
              className="text-xs font-medium text-[#313131]/70 whitespace-nowrap"
            >
              Mês/Ano:
            </label>
            <select
              id="dashboard-month-select"
              value={selectedMonthKey}
              onChange={(e) => {
                setSelectedMonthKey(e.target.value);
                setHoveredMonthKey(e.target.value);
              }}
              className="rounded-lg border border-[#313131]/20 bg-white px-3 py-1.5 text-xs font-medium text-[#313131] focus:border-[#DCB14A] focus:outline-none"
            >
              {monthOptions.map((opt) => (
                <option key={opt.monthKey} value={opt.monthKey}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs font-medium text-[#313131]/65 tabular-nums whitespace-nowrap">
            Referência: {formatDateBR(todayISO)}
          </p>
          {onRefreshPortfolio && (
            <button
              type="button"
              onClick={onRefreshPortfolio}
              disabled={isSyncing}
              data-testid="dashboard-refresh-portfolio-btn"
              title={
                isRevalidatingSWR
                  ? 'Revalidando carteira em segundo plano...'
                  : 'Atualizar carteira (Planilha SSOT, Drive e Calendar)'
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#313131]/20 bg-white px-3 py-1.5 text-xs font-medium text-[#313131] hover:border-[#DCB14A] hover:bg-[#F6F3EC] disabled:opacity-55 whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#8D6A14] ${
                  isSyncing || isRevalidatingSWR ? 'animate-spin' : ''
                }`}
              />
              <span>
                {isSyncing
                  ? 'Atualizando...'
                  : isRevalidatingSWR
                    ? 'Sincronizando...'
                    : 'Atualizar'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Discrete ZapSign Unmatched Audit Notice */}
      {auditItems.length > 0 && (
        <div
          role="status"
          data-testid="dashboard-zapsign-banner"
          className="rounded-xl border border-[#DCB14A] bg-white px-4 py-3 text-xs text-[#313131] space-y-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-[#8D6A14]" />
              <span>
                <strong className="font-semibold">
                  {auditItems.length}{' '}
                  {auditItems.length === 1
                    ? 'contrato assinado no ZapSign'
                    : 'contratos assinados no ZapSign'}
                </strong>{' '}
                ainda não constam na planilha oficial nem no Google Drive
                &ldquo;Clientes Tráfego Pago&rdquo; (deduplicado por cliente;
                excluindo pastas ZZ - Encerrados, Docs Faltavam e Fechados do
                Escritório
                {proceduralZapSignCount > 0
                  ? `; ${proceduralZapSignCount} doc(s) processuais separados`
                  : ''}
                ).
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setZapSignExpanded((prev) => !prev)}
                aria-expanded={zapSignExpanded}
                data-testid="dashboard-zapsign-toggle-btn"
                className="inline-flex items-center gap-1 rounded-md border border-[#313131]/20 bg-[#F6F3EC] px-2.5 py-1 text-[11px] font-medium text-[#313131] hover:border-[#DCB14A] hover:bg-white whitespace-nowrap"
              >
                <span>
                  {zapSignExpanded
                    ? 'Ocultar lista'
                    : `Ver lista (${auditItems.length})`}
                </span>
                {zapSignExpanded ? (
                  <ChevronUp className="h-3 w-3 text-[#8D6A14]" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-[#8D6A14]" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('clientes')}
                className="text-left sm:text-right font-semibold text-[#8D6A14] underline underline-offset-4 hover:text-[#313131] whitespace-nowrap shrink-0"
              >
                Conferir em Clientes &amp; Processos
              </button>
            </div>
          </div>

          {zapSignExpanded && (
            <ul className="max-h-72 overflow-y-auto divide-y divide-[#313131]/10 rounded-lg border border-[#313131]/10 bg-[#F6F3EC]/60">
              {auditItems.map((item) => {
                const signedDateLabel = formatZapSignDateBR(item.doc.signedAt);
                const cleanName =
                  item.extractedProfile?.cleanName || item.primarySignerName;
                const cpfLabel = item.extractedProfile?.cpf;
                return (
                  <li
                    key={item.doc.token}
                    className="flex flex-col gap-2 px-3.5 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#313131]">
                          {cleanName}
                        </p>
                        {cpfLabel && (
                          <span className="text-[10px] text-[#313131]/60 tabular-nums">
                            CPF {cpfLabel}
                          </span>
                        )}
                        {signedDateLabel && (
                          <span className="text-[10px] text-[#313131]/60 tabular-nums">
                            · Assinado em {signedDateLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#313131]/65 truncate">
                        Documento: {item.doc.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {item.driveFolder ? (
                          <a
                            href={item.driveFolder.urlPasta}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-[#DCB14A]/70 bg-white px-2 py-0.5 text-[10px] font-medium text-[#313131] hover:border-[#8D6A14]"
                          >
                            <FolderOpen className="h-3 w-3 text-[#8D6A14]" />
                            Pasta Drive encontrada ({item.driveFolder.etapa})
                            <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                          </a>
                        ) : (
                          <span className="inline-flex items-center rounded border border-[#313131]/15 bg-white/70 px-2 py-0.5 text-[10px] text-[#313131]/60">
                            Sem pasta no Drive
                          </span>
                        )}
                        {item.calendarMatch && (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-700/30 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
                            <CalendarDays className="h-3 w-3 text-emerald-700" />
                            Evento no Calendar ({item.calendarMatch.eventCount})
                          </span>
                        )}
                        <span className="inline-flex items-center rounded border border-amber-700/25 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                          Não encontrado na planilha
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {onPrefillZapSignItem && (
                        <button
                          type="button"
                          onClick={() => onPrefillZapSignItem(item)}
                          className="inline-flex items-center gap-1 rounded-md bg-[#313131] px-2.5 py-1 text-[11px] font-medium text-[#FFD559] hover:bg-[#313131]/90 whitespace-nowrap"
                        >
                          <UserPlus className="h-3 w-3" />
                          Pré-preencher cadastro
                        </button>
                      )}
                      {item.doc.signedFileUrl && (
                        <a
                          href={item.doc.signedFileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-[#313131]/20 bg-white px-2.5 py-1 text-[11px] font-medium text-[#8D6A14] hover:border-[#DCB14A] whitespace-nowrap"
                        >
                          Ver PDF
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Discrete Integrity & Parse Issues Notice (Sheets SSOT × Drive × Calendar) */}
      {hasIntegrityAlerts && (
        <div
          role="status"
          data-testid="dashboard-integrity-banner"
          className="rounded-xl border border-[#313131]/18 bg-white px-4 py-3 text-xs text-[#313131] space-y-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#8D6A14]" />
              <span>
                <strong className="font-semibold">
                  Auditoria de integridade (Planilha SSOT):
                </strong>{' '}
                {[
                  effectiveParseIssues.length > 0
                    ? `${effectiveParseIssues.length} ${
                        effectiveParseIssues.length === 1
                          ? 'célula com erro de data/valor isolada'
                          : 'células com erro de data/valor isoladas'
                      }`
                    : null,
                  missingDriveCount > 0
                    ? `${missingDriveCount} ${
                        missingDriveCount === 1
                          ? 'cliente sem pasta válida no Drive'
                          : 'clientes sem pasta válida no Drive'
                      }`
                    : null,
                  missingCalendarEventsCount > 0
                    ? `${missingCalendarEventsCount} ${
                        missingCalendarEventsCount === 1
                          ? 'parcela pendente sem evento no Calendar'
                          : 'parcelas pendentes sem evento no Calendar'
                      }`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                .
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIntegrityExpanded((prev) => !prev)}
                aria-expanded={integrityExpanded}
                data-testid="dashboard-integrity-toggle-btn"
                className="inline-flex items-center gap-1 rounded-md border border-[#313131]/20 bg-[#F6F3EC] px-2.5 py-1 text-[11px] font-medium text-[#313131] hover:border-[#DCB14A] hover:bg-white whitespace-nowrap"
              >
                <span>
                  {integrityExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                </span>
                {integrityExpanded ? (
                  <ChevronUp className="h-3 w-3 text-[#8D6A14]" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-[#8D6A14]" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('clientes')}
                className="text-left sm:text-right font-semibold text-[#8D6A14] underline underline-offset-4 hover:text-[#313131] whitespace-nowrap shrink-0"
              >
                Revisar em Clientes
              </button>
            </div>
          </div>

          {integrityExpanded && (
            <div className="space-y-3 border-t border-[#313131]/10 pt-3">
              {effectiveParseIssues.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#313131]">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                    Células da planilha isoladas sem afetar os totais da carteira (
                    {effectiveParseIssues.length})
                  </p>
                  <ul className="max-h-48 overflow-y-auto divide-y divide-[#313131]/10 rounded-lg border border-[#313131]/10 bg-[#F6F3EC]/60">
                    {effectiveParseIssues.slice(0, 25).map((issue, idx) => (
                      <li
                        key={`${issue.rowId}-${issue.field}-${idx}`}
                        className="flex flex-col gap-1 px-3 py-2 text-[11px] sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="font-medium text-[#313131]">
                          {issue.clientName}{' '}
                          <span className="font-normal text-[#313131]/60">
                            ({issue.scope} · campo "{issue.field}")
                          </span>
                        </span>
                        <span className="text-[#313131]/75 tabular-nums">
                          Valor "{issue.rawValue || 'vazio'}" — {issue.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {healthReport && clientsWithWarningsCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#313131]/10 bg-[#F6F3EC]/60 px-3 py-2 text-[11px] text-[#313131]/80">
                  <span>
                    Triangulação ativa em{' '}
                    <strong className="font-semibold text-[#313131]">
                      {healthReport.totalClients}
                    </strong>{' '}
                    clientes:{' '}
                    <strong className="font-semibold text-emerald-800">
                      {healthReport.healthyClientsCount} íntegro(s)
                    </strong>{' '}
                    e{' '}
                    <strong className="font-semibold text-amber-900">
                      {clientsWithWarningsCount} com alerta operacional
                    </strong>
                    .
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('clientes')}
                    className="font-semibold text-[#8D6A14] hover:underline"
                  >
                    Ver badges por cliente
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 6 KPI Cards */}
      <section aria-label="Indicadores principais">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {/* 1. Total a Receber */}
          <div className="rounded-xl border border-[#313131]/12 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-medium text-[#313131]/65">
              <div className="flex items-center gap-1.5">
                <span>Total a Receber</span>
                <KpiInfoTooltip
                  id="kpi-total-receber"
                  title="Total a Receber"
                  description="Saldo total a receber da planilha oficial: soma das parcelas datadas confirmadas em aberto mais o saldo sem data definida (já descontado eventual crédito a vincular)."
                  isOpen={openTooltipId === 'kpi-total-receber'}
                  onToggle={handleToggleTooltip}
                  onOpen={setHoveredTooltipId}
                  onClose={handleCloseHoverTooltip}
                />
              </div>
              <Wallet className="h-4 w-4 text-[#8D6A14]" />
            </div>
            <p className="mt-3 text-2xl font-bold tracking-tight text-[#313131] tabular-nums">
              {formatCurrencyBRL(kpis.totalAReceber)}
            </p>
            <p className="mt-1.5 text-xs text-[#313131]/60 tabular-nums">
              {(kpis.saldoSemData ?? 0) > 0 || (kpis.creditoAVincular ?? 0) > 0
                ? `Datadas: ${formatCurrencyBRL(kpis.saldoParcelasDatadas ?? kpis.totalAReceber)} · Sem data: ${formatCurrencyBRL(kpis.saldoSemData ?? 0)}${(kpis.creditoAVincular ?? 0) > 0 ? ` · Crédito: ${formatCurrencyBRL(kpis.creditoAVincular ?? 0)}` : ''}`
                : 'Soma de todas as parcelas em aberto'}
            </p>
          </div>

          {/* 2. Recebido no Mês */}
          <div className="rounded-xl border border-[#313131]/12 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-medium text-[#313131]/65">
              <div className="flex items-center gap-1.5">
                <span>Recebido no Mês</span>
                <KpiInfoTooltip
                  id="kpi-recebido-mes"
                  title="Recebido no Mês"
                  description="Total de honorários efetivamente recebidos na competência selecionada (incluindo baixas parciais, juros e créditos registrados na aba Pagamentos)."
                  isOpen={openTooltipId === 'kpi-recebido-mes'}
                  onToggle={handleToggleTooltip}
                  onOpen={setHoveredTooltipId}
                  onClose={handleCloseHoverTooltip}
                />
              </div>
              <TrendingUp className="h-4 w-4 text-emerald-700" />
            </div>
            <p className="mt-3 text-2xl font-bold tracking-tight text-[#313131] tabular-nums">
              {formatCurrencyBRL(kpis.recebidoNoMes)}
            </p>
            <p className="mt-1.5 text-xs text-emerald-800 tabular-nums">
              Previsto {formatCurrencyBRL(kpis.previstoNoMes)}
              {(kpis.faltaNoMes ?? 0) > 0
                ? ` · Falta ${formatCurrencyBRL(kpis.faltaNoMes ?? 0)}`
                : ''}
              {(kpis.totalJaRecebido ?? 0) > 0
                ? ` · Acumulado ${formatCurrencyBRL(kpis.totalJaRecebido ?? 0)}`
                : ''}
            </p>
          </div>

          {/* 3. Parcelas em Atraso */}
          <div className="rounded-xl border border-[#313131]/12 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-medium text-[#313131]/65">
              <div className="flex items-center gap-1.5">
                <span>Parcelas em Atraso</span>
                <KpiInfoTooltip
                  id="kpi-atraso"
                  title="Parcelas em Atraso"
                  description="Valor e quantidade de parcelas cujo vencimento já passou e ainda constam sem pagamento confirmado."
                  isOpen={openTooltipId === 'kpi-atraso'}
                  onToggle={handleToggleTooltip}
                  onOpen={setHoveredTooltipId}
                  onClose={handleCloseHoverTooltip}
                />
              </div>
              <AlertCircle className="h-4 w-4 text-red-700" />
            </div>
            <p className="mt-3 text-2xl font-bold tracking-tight text-red-800 tabular-nums">
              {formatCurrencyBRL(kpis.parcelasEmAtrasoValor)}
            </p>
            <p className="mt-1.5 text-xs text-[#313131]/65 tabular-nums">
              {kpis.parcelasEmAtrasoCount}{' '}
              {kpis.parcelasEmAtrasoCount === 1
                ? 'parcela vencida'
                : 'parcelas vencidas'}
              {!isCurrentMonth ? ` em ${selectedMonthLabel}` : ''}
            </p>
          </div>

          {/* 4. Vencimentos da Semana */}
          <div className="rounded-xl border border-[#313131]/12 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-medium text-[#313131]/65">
              <div className="flex items-center gap-1.5">
                <span>Vencimentos da Semana</span>
                <KpiInfoTooltip
                  id="kpi-semana"
                  title="Vencimentos da Semana"
                  description="Parcelas em aberto com vencimento entre hoje e os próximos 7 dias, ideal para planejar os contatos da semana."
                  isOpen={openTooltipId === 'kpi-semana'}
                  onToggle={handleToggleTooltip}
                  onOpen={setHoveredTooltipId}
                  onClose={handleCloseHoverTooltip}
                />
              </div>
              <CalendarClock className="h-4 w-4 text-[#8D6A14]" />
            </div>
            <p className="mt-3 text-2xl font-bold tracking-tight text-[#313131] tabular-nums">
              {formatCurrencyBRL(kpis.vencimentosSemanaValor)}
            </p>
            <p className="mt-1.5 text-xs text-[#313131]/65 tabular-nums">
              {kpis.vencimentosSemanaCount}{' '}
              {kpis.vencimentosSemanaCount === 1
                ? 'parcela nos próximos 7 dias'
                : 'parcelas nos próximos 7 dias'}
            </p>
          </div>

          {/* 5. Ticket Médio da Carteira */}
          <div className="rounded-xl border border-[#313131]/12 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-medium text-[#313131]/65">
              <div className="flex items-center gap-1.5">
                <span>Ticket Médio da Carteira</span>
                <KpiInfoTooltip
                  id="kpi-ticket-medio"
                  title="Ticket Médio da Carteira"
                  description="Valor médio contratado por cliente considerando todos os contratos ativos com valor cadastrado na planilha."
                  isOpen={openTooltipId === 'kpi-ticket-medio'}
                  onToggle={handleToggleTooltip}
                  onOpen={setHoveredTooltipId}
                  onClose={handleCloseHoverTooltip}
                />
              </div>
              <Receipt className="h-4 w-4 text-[#8D6A14]" />
            </div>
            <p className="mt-3 text-2xl font-bold tracking-tight text-[#313131] tabular-nums">
              {formatCurrencyBRL(kpis.ticketMedioCarteira)}
            </p>
            <p className="mt-1.5 text-xs text-[#313131]/60 tabular-nums">
              Média por contrato · {clients.length} clientes na base
            </p>
          </div>

          {/* 6. Taxa de Adimplência */}
          <div className="rounded-xl border border-[#313131]/12 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-medium text-[#313131]/65">
              <div className="flex items-center gap-1.5">
                <span>Taxa de Adimplência</span>
                <KpiInfoTooltip
                  id="kpi-adimplencia"
                  title="Taxa de Adimplência"
                  description="Percentual de parcelas já vencidas até a data de referência que foram pagas em dia ou quitadas."
                  isOpen={openTooltipId === 'kpi-adimplencia'}
                  onToggle={handleToggleTooltip}
                  onOpen={setHoveredTooltipId}
                  onClose={handleCloseHoverTooltip}
                />
              </div>
              <BadgeCheck className="h-4 w-4 text-[#8D6A14]" />
            </div>
            <p className="mt-3 text-2xl font-bold tracking-tight text-[#313131] tabular-nums">
              {kpis.taxaAdimplencia.toFixed(1).replace('.', ',')}%
            </p>
            <p className="mt-1.5 text-xs text-[#313131]/60 tabular-nums">
              {isCurrentMonth
                ? 'Pagamentos confirmados sobre parcelas vencidas'
                : `Adimplência apurada em ${selectedMonthLabel}`}
            </p>
          </div>
        </div>
      </section>

      {/* Main Content Split: Chart + Atenção Hoje */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 items-start">
        {/* Monthly Bar Chart: Previsto vs. Recebido */}
        <section
          aria-label="Comparativo mensal Previsto vs. Recebido"
          className="xl:col-span-5 rounded-xl border border-[#313131]/12 bg-white p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-lg font-bold text-[#313131]">
                Previsto vs. Recebido
              </h2>
              <p className="mt-0.5 text-xs text-[#313131]/65">
                Evolução mensal ao redor de {selectedMonthLabel}
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs text-[#313131]/75">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#313131]/22" />
                Previsto
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#DCB14A]" />
                Recebido
              </span>
            </div>
          </div>

          {/* Focused Month Readout */}
          {activePoint && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F6F3EC] px-4 py-2.5 text-xs">
              <span className="font-semibold text-[#313131]">
                {activePoint.label}
              </span>
              <div className="flex items-center gap-4 tabular-nums">
                <span className="text-[#313131]/75">
                  Previsto:{' '}
                  <strong className="text-[#313131]">
                    {formatCurrencyBRL(activePoint.previsto)}
                  </strong>
                </span>
                <span className="text-[#313131]/75">
                  Recebido:{' '}
                  <strong className="text-[#8D6A14]">
                    {formatCurrencyBRL(activePoint.recebido)}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {/* Accessible Bar Chart */}
          <div
            className="mt-6 grid grid-cols-6 gap-2 sm:gap-3 items-end h-56 pt-4 border-b border-[#313131]/12 pb-2"
            data-testid="monthly-bar-chart"
          >
            {chartData.map((point) => {
              const prevHeightPct = Math.round(
                (point.previsto / maxChartValue) * 100
              );
              const recHeightPct = Math.round(
                (point.recebido / maxChartValue) * 100
              );
              const isSelected = activePoint?.monthKey === point.monthKey;

              return (
                <button
                  key={point.monthKey}
                  type="button"
                  onMouseEnter={() => setHoveredMonthKey(point.monthKey)}
                  onFocus={() => setHoveredMonthKey(point.monthKey)}
                  onClick={() => setHoveredMonthKey(point.monthKey)}
                  aria-label={`${point.label}: Previsto ${formatCurrencyBRL(point.previsto)}, Recebido ${formatCurrencyBRL(point.recebido)}`}
                  className={`group flex h-full flex-col justify-end items-center rounded-md px-1 pt-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#DCB14A] ${
                    isSelected ? 'bg-[#F6F3EC]' : 'hover:bg-[#F6F3EC]/70'
                  }`}
                >
                  <div className="flex w-full flex-1 items-end justify-center gap-1.5 px-1">
                    <div
                      className="w-3.5 sm:w-4 rounded-t bg-[#313131]/22 transition-all duration-200"
                      style={{
                        height:
                          point.previsto > 0
                            ? `${Math.max(4, prevHeightPct)}%`
                            : '0%',
                      }}
                    />
                    <div
                      className="w-3.5 sm:w-4 rounded-t bg-[#DCB14A] transition-all duration-200"
                      style={{
                        height:
                          point.recebido > 0
                            ? `${Math.max(4, recHeightPct)}%`
                            : '0%',
                      }}
                    />
                  </div>
                  <span className="mt-2 text-[11px] font-medium text-[#313131]/70 tabular-nums whitespace-nowrap">
                    {point.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-[#313131]/55 tabular-nums">
            <span>R$ 0 · Escala até {formatCurrencyCompactBRL(maxChartValue)}</span>
            <button
              type="button"
              onClick={() => onNavigateTab('metas')}
              className="font-medium text-[#8D6A14] hover:text-[#313131] underline underline-offset-4"
            >
              Abrir Metas &amp; Projeções
            </button>
          </div>
        </section>

        {/* Lista Rápida: Atenção Hoje */}
        <section
          aria-label="Atenção Hoje"
          className="xl:col-span-7 rounded-xl border border-[#313131]/12 bg-white p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#313131]/12 pb-4">
            <div>
              <h2 className="font-serif text-lg font-bold text-[#313131]">
                Atenção Hoje
              </h2>
              <p className="mt-0.5 text-xs text-[#313131]/65">
                Clientes com parcelas em atraso ou com vencimento na data de hoje
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('calendario')}
              className="text-xs font-medium text-[#8D6A14] hover:text-[#313131] underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Ver calendário completo
            </button>
          </div>

          {attentionList.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-700" />
              <p className="mt-3 font-serif text-base font-bold text-[#313131]">
                Nenhuma pendência para hoje
              </p>
              <p className="mt-1 text-xs text-[#313131]/65">
                Todas as parcelas vencidas até hoje já foram quitadas.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#313131]/10">
              {attentionList.map((item) => {
                const isOverdue = item.status === 'Atrasada';
                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-sm text-[#313131] truncate">
                          {item.clientName}
                        </p>
                        <span
                          className={`text-xs font-semibold ${
                            isOverdue ? 'text-red-700' : 'text-[#8D6A14]'
                          }`}
                        >
                          · {isOverdue ? 'Atrasada' : 'Vence hoje'}
                        </span>
                      </div>
                      <p className="text-xs text-[#313131]/65 tabular-nums">
                        Parcela {item.installmentNumber}/
                        {item.totalInstallments} · Vencimento{' '}
                        {formatDateBR(item.dueDate)} ·{' '}
                        <strong className="font-semibold text-[#313131]">
                          {formatCurrencyBRL(item.amount)}
                        </strong>
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenWhatsApp(item)}
                        aria-label={`Cobrar ${item.clientName} no WhatsApp`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#313131]/20 bg-white px-3 py-2 text-xs font-medium text-[#313131] hover:bg-[#F6F3EC] whitespace-nowrap shrink-0"
                      >
                        <MessageCircle className="h-3.5 w-3.5 text-[#8D6A14]" />
                        Cobrar no WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => onMarkPaid(item)}
                        aria-label={`Marcar parcela de ${item.clientName} como paga`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#313131] px-3 py-2 text-xs font-medium text-[#FFFFFF] hover:bg-[#313131]/90 whitespace-nowrap shrink-0"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#FFD559]" />
                        Marcar como Pago
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
