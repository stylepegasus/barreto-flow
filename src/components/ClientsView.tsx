import React, { useEffect, useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileSignature,
  FileText,
  FolderOpen,
  RefreshCw,
  Search,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import {
  ClientCase,
  DRIVE_STAGES,
  DriveFileItem,
  DriveStage,
  InstallmentWithStatus,
  PAYMENT_MODALITIES,
  PaymentModality,
  ZapSignCrossReferenceItem,
  ZapSignSignedDoc,
  ZapSignState,
} from '../types/honorarios';
import {
  calculateClientTotals,
  computeInstallmentStatus,
  filterClients,
  formatCurrencyBRL,
  formatDateBR,
} from '../utils/honorariosLogic';
import {
  extractPrimarySignerName,
  formatZapSignDateBR,
} from '../utils/zapsignLogic';

interface ClientsViewProps {
  clients: ClientCase[];
  todayISO: string;
  zapSignState?: ZapSignState;
  matchedZapSignByClientId?: Record<string, ZapSignSignedDoc[]>;
  unmatchedZapSignDocs?: ZapSignSignedDoc[];
  unmatchedZapSignItems?: ZapSignCrossReferenceItem[];
  proceduralZapSignCount?: number;
  onRefreshZapSign?: () => void;
  onPrefillZapSignItem?: (item: ZapSignCrossReferenceItem) => void;
  onQuitarParcela: (item: InstallmentWithStatus) => void;
  onAlterarData: (item: InstallmentWithStatus) => void;
  onAnalyzeDocument: (client: ClientCase, file: DriveFileItem) => void;
  onSessionContextChange?: (ctx: {
    search: string;
    stage: DriveStage | 'Todas';
    modality: PaymentModality | 'Todas';
    focusedClientName: string | null;
  }) => void;
}

function formatDriveMimeLabel(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('pdf')) return 'PDF';
  if (lower.includes('document') || lower.includes('word')) return 'Documento';
  if (lower.includes('spreadsheet') || lower.includes('excel') || lower.includes('sheet')) {
    return 'Planilha';
  }
  if (lower.includes('image')) return 'Imagem';
  if (lower.includes('text')) return 'Texto';
  return 'Arquivo';
}

function formatDriveUpdatedDate(raw?: string): string | null {
  if (!raw) return null;
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return formatDateBR(isoMatch[1]);
  }
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toLocaleDateString('pt-BR');
  }
  return null;
}

export const ClientsView: React.FC<ClientsViewProps> = ({
  clients,
  todayISO,
  zapSignState,
  matchedZapSignByClientId,
  unmatchedZapSignDocs = [],
  unmatchedZapSignItems,
  proceduralZapSignCount = 0,
  onRefreshZapSign,
  onPrefillZapSignItem,
  onQuitarParcela,
  onAlterarData,
  onAnalyzeDocument,
  onSessionContextChange,
}) => {
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<DriveStage | 'Todas'>('Todas');
  const [modalityFilter, setModalityFilter] = useState<
    PaymentModality | 'Todas'
  >('Todas');
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [expandedDocsClientId, setExpandedDocsClientId] = useState<
    string | null
  >(null);
  const [zapSignExpanded, setZapSignExpanded] = useState(false);

  useEffect(() => {
    if (!onSessionContextChange) return;
    const focusedId = expandedClientId ?? expandedDocsClientId;
    const focusedClient = focusedId
      ? clients.find((c) => c.id === focusedId)
      : undefined;
    onSessionContextChange({
      search,
      stage: stageFilter,
      modality: modalityFilter,
      focusedClientName: focusedClient?.fullName ?? null,
    });
  }, [
    search,
    stageFilter,
    modalityFilter,
    expandedClientId,
    expandedDocsClientId,
    clients,
    onSessionContextChange,
  ]);

  const auditItems: ZapSignCrossReferenceItem[] =
    unmatchedZapSignItems ??
    unmatchedZapSignDocs.map((doc) => ({
      doc,
      primarySignerName: extractPrimarySignerName(doc),
      auditStatus: 'missing_in_spreadsheet',
      inSpreadsheet: false,
    }));

  const filtered = filterClients(clients, {
    search,
    stage: stageFilter,
    modality: modalityFilter,
  });

  const toggleExpand = (clientId: string) => {
    setExpandedClientId((prev) => (prev === clientId ? null : clientId));
  };

  const toggleDocsExpand = (clientId: string) => {
    setExpandedDocsClientId((prev) => (prev === clientId ? null : clientId));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between border-b border-[#313131]/12 pb-5">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#313131]">
            Clientes & Processos
          </h1>
          <p className="mt-1.5 text-sm text-[#313131]/70">
            Acompanhe a etapa no Google Drive, valores contratados e parcelas de
            cada cliente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onRefreshZapSign && (
            <button
              type="button"
              onClick={onRefreshZapSign}
              disabled={zapSignState?.loading}
              data-testid="zapsign-refresh-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#313131]/18 bg-white px-3 py-1.5 text-xs font-medium text-[#313131] hover:border-[#DCB14A] hover:bg-[#F6F3EC] disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#8D6A14] ${
                  zapSignState?.loading ? 'animate-spin' : ''
                }`}
              />
              <span>
                {zapSignState?.loading
                  ? 'Consultando ZapSign...'
                  : zapSignState?.configured
                    ? `ZapSign: ${zapSignState.docs.length} assinado(s)`
                    : 'Verificar ZapSign'}
              </span>
            </button>
          )}
          <p className="text-xs font-medium text-[#313131]/65 tabular-nums whitespace-nowrap">
            Exibindo {filtered.length} de {clients.length} clientes
          </p>
        </div>
      </div>

      {/* Discrete ZapSign Audit Banner (only active contracts missing from spreadsheet, excluding ignored folders) */}
      {auditItems.length > 0 && (
        <div
          data-testid="zapsign-unmatched-banner"
          className="rounded-xl border border-[#DCB14A] bg-white p-4 space-y-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <FileSignature className="mt-0.5 h-4 w-4 text-[#8D6A14] shrink-0" />
              <div>
                <h2 className="font-serif text-sm font-bold text-[#313131]">
                  {auditItems.length}{' '}
                  {auditItems.length === 1
                    ? 'contrato assinado no ZapSign sem cadastro na planilha'
                    : 'contratos assinados no ZapSign sem cadastro na planilha'}
                </h2>
                <p className="mt-0.5 text-xs text-[#313131]/70">
                  Coligação ZapSign × Planilha × Google Drive × Google Calendar
                  (somente status Assinado, excluindo pastas ZZ - Encerrados,
                  Docs Faltavam e Fechados do Escritório
                  {proceduralZapSignCount > 0
                    ? `; ${proceduralZapSignCount} documento(s) processuais separados`
                    : ''}
                  ).
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setZapSignExpanded((prev) => !prev)}
              aria-expanded={zapSignExpanded}
              data-testid="zapsign-toggle-list-btn"
              className="inline-flex items-center gap-1.5 self-start sm:self-center rounded-lg border border-[#313131]/20 bg-[#F6F3EC] px-3 py-1.5 text-xs font-medium text-[#313131] hover:border-[#DCB14A] hover:bg-white whitespace-nowrap shrink-0"
            >
              <span>
                {zapSignExpanded
                  ? 'Recolher lista'
                  : `Ver lista (${auditItems.length})`}
              </span>
              {zapSignExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 text-[#8D6A14]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-[#8D6A14]" />
              )}
            </button>
          </div>

          {zapSignExpanded && (
            <ul className="max-h-80 overflow-y-auto divide-y divide-[#313131]/10 rounded-lg border border-[#313131]/10 bg-[#F6F3EC]/60">
              {auditItems.map((item) => {
                const doc = item.doc;
                const signedDateLabel = formatZapSignDateBR(doc.signedAt);
                const cleanName =
                  item.extractedProfile?.cleanName || item.primarySignerName;
                const cpfLabel = item.extractedProfile?.cpf;
                const phoneLabel = item.extractedProfile?.phone;
                return (
                  <li
                    key={doc.token}
                    className="flex flex-col gap-2 px-3.5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#313131]">
                          {cleanName}
                        </p>
                        {cpfLabel && (
                          <span className="text-[10px] text-[#313131]/65 tabular-nums">
                            CPF {cpfLabel}
                          </span>
                        )}
                        {phoneLabel && (
                          <span className="text-[10px] text-[#313131]/65 tabular-nums">
                            · {phoneLabel}
                          </span>
                        )}
                        {signedDateLabel && (
                          <span className="text-[10px] text-[#313131]/65 tabular-nums">
                            · Assinado em {signedDateLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#313131]/65 truncate">
                        Documento: {doc.name}
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
                      {doc.signedFileUrl && (
                        <a
                          href={doc.signedFileUrl}
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

      {/* Filters Toolbar */}
      <div className="rounded-xl border border-[#313131]/12 bg-white p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-5">
            <label
              htmlFor="client-search-input"
              className="block text-xs font-medium text-[#313131]/80"
            >
              Buscar por nome ou assunto
            </label>
            <div className="relative mt-1.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#313131]/45" />
              <input
                id="client-search-input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ex.: Mariana, Divórcio, Pensão..."
                className="w-full rounded-lg border border-[#313131]/18 bg-[#F6F3EC] py-2 pl-9 pr-3 text-sm text-[#313131] placeholder:text-[#313131]/45 focus:border-[#DCB14A] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div className="md:col-span-4">
            <label
              htmlFor="stage-filter-select"
              className="block text-xs font-medium text-[#313131]/80"
            >
              Etapa no Google Drive
            </label>
            <select
              id="stage-filter-select"
              value={stageFilter}
              onChange={(e) =>
                setStageFilter(e.target.value as DriveStage | 'Todas')
              }
              className="mt-1.5 w-full rounded-lg border border-[#313131]/18 bg-[#F6F3EC] px-3 py-2 text-sm text-[#313131] focus:border-[#DCB14A] focus:bg-white focus:outline-none"
            >
              <option value="Todas">Todas as etapas</option>
              {DRIVE_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label
              htmlFor="modality-filter-select"
              className="block text-xs font-medium text-[#313131]/80"
            >
              Modalidade
            </label>
            <select
              id="modality-filter-select"
              value={modalityFilter}
              onChange={(e) =>
                setModalityFilter(e.target.value as PaymentModality | 'Todas')
              }
              className="mt-1.5 w-full rounded-lg border border-[#313131]/18 bg-[#F6F3EC] px-3 py-2 text-sm text-[#313131] focus:border-[#DCB14A] focus:bg-white focus:outline-none"
            >
              <option value="Todas">Todas</option>
              {PAYMENT_MODALITIES.map((mod) => (
                <option key={mod} value={mod}>
                  {mod}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Clients List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-[#313131]/12 bg-white p-12 text-center">
          <p className="font-serif text-lg font-bold text-[#313131]">
            Nenhum cliente encontrado
          </p>
          <p className="mt-1.5 text-sm text-[#313131]/65">
            Ajuste os filtros de etapa, modalidade ou limpe o campo de busca.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStageFilter('Todas');
              setModalityFilter('Todas');
            }}
            className="mt-4 rounded-lg border border-[#313131]/20 bg-white px-4 py-2 text-xs font-medium text-[#313131] hover:bg-[#313131]/5"
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className="space-y-3" data-testid="clients-list">
          {filtered.map((client) => {
            const totals = calculateClientTotals(client, todayISO);
            const isExpanded = expandedClientId === client.id;
            const isDocsExpanded = expandedDocsClientId === client.id;
            const driveFiles = client.driveFiles ?? [];
            const clientZapSignDocs = matchedZapSignByClientId?.[client.id] ?? [];
            const latestZapSignDoc = clientZapSignDocs[0];
            const situacaoColor =
              totals.situacao === 'Com atraso'
                ? 'text-red-700'
                : totals.situacao === 'Quitado'
                  ? 'text-emerald-700'
                  : 'text-[#8D6A14]';

            return (
              <div
                key={client.id}
                className="rounded-xl border border-[#313131]/12 bg-white overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
                    {/* Client Info */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <h2 className="font-serif text-base font-bold text-[#313131]">
                          {client.fullName}
                        </h2>
                        <span className={`text-xs font-semibold ${situacaoColor}`}>
                          · {totals.situacao}
                        </span>
                      </div>
                      <p
                        className="text-xs text-[#313131]/70 truncate"
                        title={`${client.caseType}${client.processNumber ? ` · Processo ${client.processNumber}` : ''}`}
                      >
                        {client.caseType}
                        {client.processNumber
                          ? ` · Processo ${client.processNumber}`
                          : ''}
                      </p>
                      <p className="text-xs text-[#313131]/60">
                        {client.driveStage} · {client.modality}
                      </p>
                      {latestZapSignDoc && (
                        <p
                          data-testid={`client-zapsign-status-${client.id}`}
                          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium text-emerald-800 tabular-nums"
                        >
                          <span className="inline-flex items-center gap-1">
                            <FileSignature className="h-3.5 w-3.5 text-[#8D6A14]" />
                            Assinado no ZapSign
                            {formatZapSignDateBR(latestZapSignDoc.signedAt)
                              ? ` · ${formatZapSignDateBR(latestZapSignDoc.signedAt)}`
                              : ''}
                          </span>
                          {latestZapSignDoc.signedFileUrl && (
                            <a
                              href={latestZapSignDoc.signedFileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#8D6A14] hover:underline"
                            >
                              Contrato PDF
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </p>
                      )}
                    </div>

                    {/* Financial Summary */}
                    <div className="grid grid-cols-3 gap-4 border-t border-[#313131]/10 pt-3 lg:w-[348px] lg:shrink-0 lg:border-t-0 lg:pt-0">
                      <div>
                        <p className="text-[11px] text-[#313131]/60 whitespace-nowrap">
                          Total contratado
                        </p>
                        <p className="mt-0.5 text-sm font-semibold text-[#313131] tabular-nums whitespace-nowrap">
                          {formatCurrencyBRL(totals.totalContratado)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-[#313131]/60 whitespace-nowrap">
                          Total pago
                        </p>
                        <p className="mt-0.5 text-sm font-semibold text-emerald-800 tabular-nums whitespace-nowrap">
                          {formatCurrencyBRL(totals.totalPago)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-[#313131]/60 whitespace-nowrap">
                          Saldo restante
                        </p>
                        <p className="mt-0.5 text-sm font-semibold text-[#313131] tabular-nums whitespace-nowrap">
                          {formatCurrencyBRL(totals.saldoRestante)}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <a
                        href={client.driveFolderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#313131]/20 bg-white px-3 py-2 text-xs font-medium text-[#313131] hover:bg-[#F6F3EC] whitespace-nowrap shrink-0"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-[#8D6A14]" />
                        Pasta no Drive
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </a>
                      <button
                        type="button"
                        onClick={() => toggleDocsExpand(client.id)}
                        aria-expanded={isDocsExpanded}
                        aria-label={`${isDocsExpanded ? 'Ocultar' : 'Ver'} documentos no Drive de ${client.fullName}`}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                          isDocsExpanded
                            ? 'border-[#DCB14A] bg-[#F6F3EC] text-[#313131]'
                            : 'border-[#313131]/20 bg-white text-[#313131] hover:bg-[#F6F3EC]'
                        }`}
                      >
                        <FileText className="h-3.5 w-3.5 text-[#8D6A14]" />
                        <span>Documentos no Drive ({driveFiles.length})</span>
                        {isDocsExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5 text-[#8D6A14]" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-[#8D6A14]" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleExpand(client.id)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Ocultar' : 'Ver'} parcelas de ${client.fullName}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#313131] px-3 py-2 text-xs font-medium text-[#FFFFFF] hover:bg-[#313131]/90 whitespace-nowrap shrink-0"
                      >
                        <span>
                          Parcelas ({totals.paidCount}/
                          {totals.totalInstallmentsCount})
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5 text-[#FFD559]" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-[#FFD559]" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Drive Documents */}
                {isDocsExpanded && (
                  <div
                    className="border-t border-[#313131]/12 bg-[#F6F3EC]/85 px-5 py-4"
                    data-testid={`client-drive-docs-${client.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <h3 className="font-serif text-sm font-bold text-[#313131]">
                        Documentos no Drive ({driveFiles.length})
                      </h3>
                      <span className="text-[11px] text-[#313131]/65">
                        Leitura direta sob demanda · Somente Leitura
                      </span>
                    </div>

                    {driveFiles.length === 0 ? (
                      <p className="text-xs text-[#313131]/65 py-1.5">
                        Nenhum arquivo listado dentro desta pasta do Google Drive.
                      </p>
                    ) : (
                      <ul className="divide-y divide-[#313131]/10 rounded-lg border border-[#313131]/12 bg-white">
                        {driveFiles.map((file) => {
                          const updatedLabel = formatDriveUpdatedDate(
                            file.atualizadoEm
                          );
                          return (
                            <li
                              key={file.id}
                              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex items-start gap-2.5 min-w-0">
                                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#8D6A14]" />
                                <div className="min-w-0">
                                  <p
                                    className="text-xs font-semibold text-[#313131] truncate"
                                    title={file.nome}
                                  >
                                    {file.nome}
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-[#313131]/60 tabular-nums">
                                    {formatDriveMimeLabel(file.mimeType)}
                                    {updatedLabel
                                      ? ` · Atualizado em ${updatedLabel}`
                                      : ''}
                                  </p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <a
                                  href={file.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 rounded-md border border-[#313131]/20 bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#313131] hover:bg-[#F6F3EC] whitespace-nowrap"
                                >
                                  Abrir no Drive
                                  <ExternalLink className="h-3 w-3 opacity-60" />
                                </a>
                                <button
                                  type="button"
                                  onClick={() => onAnalyzeDocument(client, file)}
                                  aria-label={`Analisar ${file.nome} com a Dona`}
                                  className="inline-flex items-center gap-1.5 rounded-md bg-[#313131] px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-[#313131]/90 whitespace-nowrap"
                                >
                                  <Sparkles className="h-3 w-3 text-[#DCB14A]" />
                                  Analisar com a Dona
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {/* Expanded Installment Schedule */}
                {isExpanded && (
                  <div className="border-t border-[#313131]/12 bg-[#F6F3EC] px-5 py-4">
                    {client.notes && (
                      <p className="mb-3 text-xs text-[#313131]/70">
                        Observação: {client.notes}
                      </p>
                    )}

                    {client.installments.length === 0 ? (
                      <p className="text-xs text-[#313131]/65 py-2">
                        Contrato vinculado exclusivamente ao êxito final do processo
                        (30%), sem parcelas mensais cadastradas.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-[#313131]/12 text-[#313131]/60">
                              <th className="py-2 pr-4 font-medium">Parcela</th>
                              <th className="py-2 pr-4 font-medium">
                                Vencimento
                              </th>
                              <th className="py-2 pr-4 font-medium">Valor</th>
                              <th className="py-2 pr-4 font-medium">Situação</th>
                              <th className="py-2 text-right font-medium">
                                Ações
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#313131]/10">
                            {client.installments.map((inst) => {
                              const status = computeInstallmentStatus(
                                inst,
                                todayISO
                              );
                              const enriched: InstallmentWithStatus = {
                                ...inst,
                                status,
                                clientPhone: client.phone,
                                caseType: client.caseType,
                                driveStage: client.driveStage,
                                modality: client.modality,
                              };

                              return (
                                <tr key={inst.id}>
                                  <td className="py-2.5 pr-4 font-medium text-[#313131] tabular-nums">
                                    {inst.installmentNumber}/
                                    {inst.totalInstallments}
                                  </td>
                                  <td className="py-2.5 pr-4 text-[#313131]/80 tabular-nums">
                                    {formatDateBR(inst.dueDate)}
                                  </td>
                                  <td className="py-2.5 pr-4 font-medium text-[#313131] tabular-nums">
                                    {formatCurrencyBRL(inst.amount)}
                                  </td>
                                  <td className="py-2.5 pr-4">
                                    <span
                                      className={`font-semibold ${
                                        status === 'Paga'
                                          ? 'text-emerald-700'
                                          : status === 'Atrasada'
                                            ? 'text-red-700'
                                            : 'text-[#8D6A14]'
                                      }`}
                                    >
                                      {status}
                                    </span>
                                    {inst.paidDate && (
                                      <span className="ml-1.5 text-[#313131]/55 tabular-nums">
                                        ({formatDateBR(inst.paidDate)})
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 text-right">
                                    {status !== 'Paga' ? (
                                      <div className="inline-flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onQuitarParcela(enriched)
                                          }
                                          className="inline-flex items-center gap-1 rounded border border-[#313131]/20 bg-white px-2.5 py-1 text-[11px] font-medium text-[#313131] hover:bg-[#313131] hover:text-white whitespace-nowrap shrink-0"
                                        >
                                          <CheckCircle2 className="h-3 w-3" />
                                          Quitar
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onAlterarData(enriched)}
                                          className="inline-flex items-center gap-1 rounded border border-[#313131]/20 bg-white px-2.5 py-1 text-[11px] font-medium text-[#313131] hover:bg-[#313131]/5 whitespace-nowrap shrink-0"
                                        >
                                          <CalendarClock className="h-3 w-3" />
                                          Alterar Data
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-[11px] text-[#313131]/50">
                                        Concluída
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
