import type {
  ActiveTab,
  AppsScriptCalendarEventRow,
  AppsScriptDashboardSnapshot,
  AppsScriptPaymentRow,
  ClientCase,
  DataSourceMode,
  DriveFileItem,
  ZapSignCrossReferenceItem,
} from '../types/honorarios.ts';
import {
  addDaysISO,
  calculateClientTotals,
  calculateDashboardKPIs,
  flattenInstallments,
  formatCurrencyBRL,
  formatDateBR,
  getAttentionTodayList,
} from './honorariosLogic.ts';
import { normalizeText } from './sheetArchitecture.ts';

export const ASSISTANT_NAME = 'Dona';
export const ASSISTANT_FIRM_NAME = 'Barreto Advocacia';
export const ASSISTANT_ROLE_LABEL = 'Assistente Financeira e Operacional';
export const MAX_PORTFOLIO_CONTEXT_CHARS = 48000;

export function buildDonaSystemPrompt(portfolioContext: string): string {
  const trimmedContext = String(portfolioContext ?? '').trim();

  return [
    `Você é ${ASSISTANT_NAME}, a ${ASSISTANT_ROLE_LABEL.toLowerCase()} exclusiva da ${ASSISTANT_FIRM_NAME} (especializada em Direito de Família) no painel Barreto Flow.`,
    'Refira-se a si mesma exclusivamente como Dona. Seu perfil de resposta é DIRETO E EXECUTIVO: vá direto aos números, clientes prioritários, cobranças pendentes e alertas críticos, sem rodeios nem jargões técnicos desnecessários, em português do Brasil (pt-BR).',
    '',
    'PRIORIDADES E REGRAS OPERACIONAIS:',
    '1. ESTILO EXECUTIVO: Abra sempre com o resumo objetivo do que exige ação imediata (valores em aberto, atrasos, vencimentos do dia/semana e alertas), usando tópicos curtos, valores em R$ (padrão brasileiro) e datas em DD/MM/AAAA.',
    '2. FIDELIDADE ABSOLUTA AOS DADOS: Nunca invente clientes, valores, datas, números de processo, parcelas, status ou fatos que não estejam explicitamente presentes no contexto da sessão ou no documento anexado. Se faltar algum dado, sinalize objetivamente a ausência e indique onde confirmar (planilha oficial, Google Drive ou nova sincronização).',
    '3. MODO SOMENTE LEITURA: Nunca afirme que alterou a planilha oficial ou o Google Calendar. Quando houver pendência de atualização, informe de forma enxuta qual linha/cliente ajustar na planilha "Barreto — Honorários (Ads Família)" ou qual compromisso registrar na agenda (janela padrão 13h30 às 14h30).',
    '4. COBRANÇAS WHATSAPP: Ao redigir mensagens de cobrança, mantenha tom humano, respeitoso e firme, informando parcela, valor, vencimento e a chave PIX oficial da Barreto Advocacia (barretoadvocacia01@gmail.com) quando aplicável.',
    '5. ANÁLISE DE DOCUMENTOS DO DRIVE: Ao analisar contratos, procurações, decisões ou protocolos anexados, extraia em tópicos objetivos apenas o que constar no documento: (a) número do processo e objeto; (b) datas e prazos relevantes; (c) valores de honorários, entrada, parcelas e êxito; (d) regras de vencimento/pagamento; (e) ajustes recomendados na planilha ou agenda.',
    '6. METAS, PROJEÇÕES E AUDITORIA ZAPSIGN: Quando consultada sobre metas/ROI ou auditoria, compare objetivamente a meta do mês com Previsto/Recebido e o Simulador (calculando contratos faltantes para bater a meta) ou liste exatamente os contratos assinados no ZapSign sem cadastro/parcelas confirmadas na planilha.',
    '',
    trimmedContext
      ? `CONTEXTO ATUAL DA SESSÃO E DA CARTEIRA (${ASSISTANT_FIRM_NAME} — BARRETO FLOW):\n${trimmedContext}`
      : 'Nenhum dado adicional da carteira foi enviado nesta chamada.',
  ].join('\n');
}

export interface AssistantActiveFilters {
  search?: string;
  stage?: string;
  modality?: string;
}

export interface AssistantFocusedInstallment {
  clientName: string;
  installmentNumber: number;
  totalInstallments: number;
  amount: number;
  dueDate: string;
  status: string;
}

export interface AssistantContextExtras {
  activeTab?: ActiveTab;
  selectedMonthKey?: string;
  sourceMode?: DataSourceMode;
  readOnlyMode?: boolean;
  activeFilters?: AssistantActiveFilters;
  focusedClientName?: string | null;
  focusedInstallment?: AssistantFocusedInstallment | null;
  goalsByMonth?: Record<string, number>;
  defaultGoal?: number;
  simulatorInputs?: {
    monthlyAdsSpend: number;
    costPerLead: number;
    conversionRatePct: number;
    averageTicket: number;
    averageInstallments: number;
    estimatedDefaultPct: number;
  };
  simulatorOutputs?: {
    estimatedLeads: number;
    closedContractsPerMonth: number;
    grossContractedRevenue: number;
    addedMonthlyRecurringRevenue: number;
    netCashAfterDefault: number;
    projectedRoiPct: number;
    roiMultiple: number;
  };
  zapSignDocs?: Array<{
    token: string;
    name: string;
    signedAt: string;
    signers: Array<{ name: string; email?: string; phone?: string }>;
  }>;
  unmatchedZapSignDocs?: Array<{
    token: string;
    name: string;
    signedAt: string;
    signers: Array<{ name: string }>;
  }>;
  unmatchedZapSignItems?: ZapSignCrossReferenceItem[];
  officialDashboard?: AppsScriptDashboardSnapshot | null;
  payments?: AppsScriptPaymentRow[];
}

const VIEW_LABELS: Record<ActiveTab, string> = {
  dashboard: 'Dashboard (Visão Geral dos Honorários)',
  calendario: 'Calendário de Cobranças',
  clientes: 'Clientes & Processos',
  metas: 'Metas & Projeções',
  configuracoes: 'Configurações & Conexão Google',
};

const SECRET_PATTERN =
  /\b(?:AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z._-]{15,}|sk-[0-9A-Za-z_-]{16,}|Bearer\s+[0-9A-Za-z._-]{16,})\b/gi;

export function sanitizeContextText(value: unknown, maxLen = 180): string {
  const cleaned = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(SECRET_PATTERN, '[credencial ocultada]')
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

export function getActiveTabLabel(tab?: ActiveTab): string {
  if (!tab) return VIEW_LABELS.dashboard;
  return VIEW_LABELS[tab] ?? VIEW_LABELS.dashboard;
}

function getSourceModeLabel(
  sourceMode?: DataSourceMode,
  readOnlyMode?: boolean
): string {
  if (sourceMode === 'apps_script' || sourceMode === 'google_workspace') {
    if (readOnlyMode ?? true) return 'Planilha Real (Somente Leitura)';
    return sourceMode === 'apps_script'
      ? 'Planilha Real (Apps Script)'
      : 'Google Workspace ativo';
  }
  return 'Base de demonstração';
}

function formatActiveFiltersSummary(
  filters?: AssistantActiveFilters
): string | null {
  if (!filters) return null;
  const parts: string[] = [];
  const search = sanitizeContextText(filters.search ?? '', 60);
  if (search) parts.push(`Busca: "${search}"`);
  if (filters.stage && filters.stage !== 'Todas') {
    parts.push(`Etapa Drive: ${sanitizeContextText(filters.stage, 60)}`);
  }
  if (filters.modality && filters.modality !== 'Todas') {
    parts.push(`Modalidade: ${sanitizeContextText(filters.modality, 40)}`);
  }
  return parts.length > 0 ? parts.join(' | ') : null;
}

function clampContextBudget(lines: string[], maxChars: number): string {
  const fullText = lines.join('\n');
  if (fullText.length <= maxChars) return fullText;

  const truncationFooter =
    '\n\n[Resumo condensado para preservar o limite de contexto da sessão. Peça detalhes de um cliente ou mês específico se precisar.]';
  const targetLen = Math.max(200, maxChars - truncationFooter.length);
  const sliced = fullText.slice(0, targetLen);
  const lastNewline = sliced.lastIndexOf('\n');
  const cleanCut =
    lastNewline > targetLen * 0.7 ? sliced.slice(0, lastNewline) : sliced;
  return `${cleanCut.trimEnd()}${truncationFooter}`;
}

export function buildPortfolioContextSummary(
  clients: ClientCase[],
  calendarEvents: AppsScriptCalendarEventRow[],
  todayISO: string,
  extras?: AssistantContextExtras
): string {
  const activeMonthKey = extras?.selectedMonthKey || todayISO.slice(0, 7);
  const kpis = calculateDashboardKPIs(clients, todayISO, activeMonthKey, {
    officialDashboard: extras?.officialDashboard,
    payments: extras?.payments,
  });
  const attention = getAttentionTodayList(clients, todayISO);
  const weekEnd = addDaysISO(todayISO, 7);
  const allInstallments = flattenInstallments(clients, todayISO);
  const openInstallments = allInstallments.filter((i) => i.status !== 'Paga');
  const upcomingWeek = openInstallments
    .filter((i) => i.dueDate > todayISO && i.dueDate <= weekEnd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  let portfolioContracted = 0;
  let portfolioPaid = 0;
  for (const client of clients) {
    const totals = calculateClientTotals(client, todayISO);
    portfolioContracted += totals.totalContratado;
    portfolioPaid += totals.totalPago;
  }

  const lines: string[] = [
    `ASSISTENTE: ${ASSISTANT_NAME} (${ASSISTANT_ROLE_LABEL} — ${ASSISTANT_FIRM_NAME} / Barreto Flow)`,
    `Data de referência: ${formatDateBR(todayISO)} (${todayISO})`,
  ];

  if (extras?.activeTab) {
    lines.push(`Visão atual no painel: ${getActiveTabLabel(extras.activeTab)}`);
  }

  if (extras?.sourceMode !== undefined) {
    lines.push(
      `Origem dos dados: ${getSourceModeLabel(extras.sourceMode, extras.readOnlyMode)}`
    );
  }

  const filtersSummary = formatActiveFiltersSummary(extras?.activeFilters);
  if (filtersSummary) {
    lines.push(`Filtros ativos na tela: ${filtersSummary}`);
  }

  if (extras?.focusedInstallment) {
    const fi = extras.focusedInstallment;
    lines.push(
      `Cobrança em foco na tela: ${sanitizeContextText(fi.clientName, 80)} | Parcela ${fi.installmentNumber}/${fi.totalInstallments} | Valor ${formatCurrencyBRL(fi.amount)} | Venc: ${formatDateBR(fi.dueDate)} | Status: ${sanitizeContextText(fi.status, 30)}`
    );
  } else if (extras?.focusedClientName) {
    lines.push(
      `Cliente em foco na tela: ${sanitizeContextText(extras.focusedClientName, 80)}`
    );
  }

  lines.push(
    `Total de clientes na carteira: ${clients.length} | Parcelas em aberto: ${openInstallments.length} | Total contratado: ${formatCurrencyBRL(portfolioContracted)} | Total já recebido acumulado: ${formatCurrencyBRL(kpis.totalJaRecebido ?? portfolioPaid)}`
  );
  lines.push(
    `KPIs do mês em análise (${kpis.selectedMonthKey}): Total a Receber ${formatCurrencyBRL(kpis.totalAReceber)} (Parcelas datadas: ${formatCurrencyBRL(kpis.saldoParcelasDatadas ?? kpis.totalAReceber)} | Saldo sem data: ${formatCurrencyBRL(kpis.saldoSemData ?? 0)}${(kpis.creditoAVincular ?? 0) > 0 ? ` | Crédito a vincular: ${formatCurrencyBRL(kpis.creditoAVincular ?? 0)}` : ''}) | Recebido no mês ${formatCurrencyBRL(kpis.recebidoNoMes)} | Previsto no mês ${formatCurrencyBRL(kpis.previstoNoMes)} | Falta das parcelas do mês ${formatCurrencyBRL(kpis.faltaNoMes ?? 0)} | Ticket médio ${formatCurrencyBRL(kpis.ticketMedioCarteira)} | Taxa de adimplência ${kpis.taxaAdimplencia.toFixed(1)}% | Em atraso ${kpis.parcelasEmAtrasoCount} parcela(s) (${formatCurrencyBRL(kpis.parcelasEmAtrasoValor)}) | Vencimentos próximos 7 dias ${kpis.vencimentosSemanaCount} parcela(s) (${formatCurrencyBRL(kpis.vencimentosSemanaValor)})`
  );

  lines.push('');
  lines.push('ATENÇÃO HOJE (Atrasadas ou vencendo hoje):');
  if (attention.length === 0) {
    lines.push('- Nenhuma parcela vencida ou vencendo hoje.');
  } else {
    for (const item of attention.slice(0, 35)) {
      lines.push(
        `- ${sanitizeContextText(item.clientName, 80)} | Tel: ${sanitizeContextText(item.clientPhone, 30)} | Objeto: ${sanitizeContextText(item.caseType, 70)} | Parcela ${item.installmentNumber}/${item.totalInstallments} | Valor: ${formatCurrencyBRL(item.amount)} | Venc: ${formatDateBR(item.dueDate)} | Status: ${item.status}`
      );
    }
    if (attention.length > 35) {
      lines.push(`... e mais ${attention.length - 35} pendência(s).`);
    }
  }

  lines.push('');
  lines.push('VENCIMENTOS DOS PRÓXIMOS 7 DIAS:');
  if (upcomingWeek.length === 0) {
    lines.push('- Nenhum vencimento nos próximos 7 dias.');
  } else {
    for (const item of upcomingWeek.slice(0, 25)) {
      lines.push(
        `- ${sanitizeContextText(item.clientName, 80)} | Parcela ${item.installmentNumber}/${item.totalInstallments} | Valor: ${formatCurrencyBRL(item.amount)} | Venc: ${formatDateBR(item.dueDate)}`
      );
    }
    if (upcomingWeek.length > 25) {
      lines.push(`... e mais ${upcomingWeek.length - 25} parcela(s) na semana.`);
    }
  }

  if (extras?.goalsByMonth || extras?.simulatorInputs || extras?.simulatorOutputs) {
    lines.push('');
    lines.push('METAS MENSAIS & SIMULADOR DE PROJEÇÕES (ADS):');
    const goalMonthKey = activeMonthKey;
    const currentGoal =
      extras.goalsByMonth?.[goalMonthKey] ?? extras.defaultGoal ?? 25000;
    lines.push(
      `- Meta configurada para o mês atual (${goalMonthKey}): ${formatCurrencyBRL(currentGoal)}`
    );
    if (extras.goalsByMonth) {
      const configuredEntries = Object.entries(extras.goalsByMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 10)
        .map(([k, v]) => `${k}: ${formatCurrencyBRL(v)}`);
      if (configuredEntries.length > 0) {
        lines.push(`- Metas por mês configuradas: ${configuredEntries.join(' | ')}`);
      }
    }
    if (extras.simulatorInputs && extras.simulatorOutputs) {
      const inp = extras.simulatorInputs;
      const out = extras.simulatorOutputs;
      lines.push(
        `- Parâmetros do Simulador: Investimento Ads ${formatCurrencyBRL(inp.monthlyAdsSpend)}/mês | CPL ${formatCurrencyBRL(inp.costPerLead)} | Conversão ${inp.conversionRatePct}% | Ticket médio ${formatCurrencyBRL(inp.averageTicket)} em ${inp.averageInstallments}x | Inadimplência estimada ${inp.estimatedDefaultPct}%`
      );
      lines.push(
        `- Resultados Projetados do Simulador: ${out.estimatedLeads.toFixed(1)} leads/mês | ${out.closedContractsPerMonth.toFixed(1)} contratos fechados/mês | Faturamento bruto contratado ${formatCurrencyBRL(out.grossContractedRevenue)} | Receita mensal recorrente adicionada ${formatCurrencyBRL(out.addedMonthlyRecurringRevenue)} | Caixa líquido (pós-inadimplência) ${formatCurrencyBRL(out.netCashAfterDefault)} | ROI projetado ${out.projectedRoiPct.toFixed(1)}% (${out.roiMultiple.toFixed(2)}x)`
      );
    }
  }

  if (extras?.zapSignDocs) {
    lines.push('');
    lines.push(
      `DOCUMENTOS ASSINADOS NO ZAPSIGN (${extras.zapSignDocs.length} total, somente status signed):`
    );
    if (extras.zapSignDocs.length === 0) {
      lines.push('- Nenhum documento assinado carregado do ZapSign.');
    } else {
      for (const doc of extras.zapSignDocs.slice(0, 30)) {
        const signersLabel = doc.signers
          .map(
            (s) =>
              `${sanitizeContextText(s.name, 60)}${s.email ? ` (${sanitizeContextText(s.email, 60)})` : ''}`
          )
          .join(', ');
        lines.push(
          `- ${sanitizeContextText(doc.name, 90)} | Assinado em: ${sanitizeContextText(doc.signedAt, 30)} | Signatários: ${signersLabel || 'Não informado'}`
        );
      }
      if (extras.zapSignDocs.length > 30) {
        lines.push(
          `... e mais ${extras.zapSignDocs.length - 30} documento(s) assinado(s) no ZapSign.`
        );
      }
      if (
        extras.unmatchedZapSignItems &&
        extras.unmatchedZapSignItems.length > 0
      ) {
        lines.push(
          `CONTRATOS ASSINADOS NO ZAPSIGN QUE NÃO CONSTAM NA PLANILHA (${extras.unmatchedZapSignItems.length}, excluindo ZZ - Encerrados):`
        );
        for (const item of extras.unmatchedZapSignItems.slice(0, 25)) {
          const driveLabel = item.driveFolder
            ? `Pasta no Drive: ${sanitizeContextText(item.driveFolder.etapa, 60)}`
            : 'Sem pasta no Drive';
          lines.push(
            `- ALERTA AUDITORIA: Signatário ${sanitizeContextText(item.primarySignerName, 70)} | Doc: "${sanitizeContextText(item.doc.name, 90)}" (Assinado em ${sanitizeContextText(item.doc.signedAt, 30)}) | ${driveLabel}`
          );
        }
      } else if (
        extras.unmatchedZapSignDocs &&
        extras.unmatchedZapSignDocs.length > 0
      ) {
        lines.push(
          `CONTRATOS ASSINADOS NO ZAPSIGN QUE NÃO CONSTAM NA PLANILHA (${extras.unmatchedZapSignDocs.length}):`
        );
        for (const u of extras.unmatchedZapSignDocs.slice(0, 25)) {
          lines.push(
            `- ALERTA AUDITORIA: "${sanitizeContextText(u.name, 90)}" (Assinado em ${sanitizeContextText(u.signedAt, 30)}) | Signatários: ${u.signers.map((s) => sanitizeContextText(s.name, 60)).join(', ')}`
          );
        }
      } else {
        lines.push(
          '- Auditoria ZapSign × Planilha × Drive: todos os documentos assinados ativos possuem correspondência na planilha (itens em ZZ - Encerrados marcados como Encerrado (não cobrar)).'
        );
      }
    }
  }

  lines.push('');
  lines.push('CLIENTES, PROCESSO, OBJETO, SITUAÇÃO E ARQUIVOS NO GOOGLE DRIVE:');
  for (const c of clients) {
    const totals = calculateClientTotals(c, todayISO);
    const allFiles = c.driveFiles ?? [];
    const listedFiles = allFiles
      .slice(0, 8)
      .map((f) => `${sanitizeContextText(f.nome, 70)} (${sanitizeContextText(f.mimeType, 40)})`)
      .join('; ');
    const extraFilesSuffix =
      allFiles.length > 8 ? `; +${allFiles.length - 8} arquivo(s)` : '';
    const filesLabel =
      allFiles.length > 0
        ? `${listedFiles}${extraFilesSuffix}`
        : 'sem arquivos listados';
    const processLabel = c.processNumber
      ? `Processo: ${sanitizeContextText(c.processNumber, 40)}`
      : 'Sem nº de processo informado';
    const notesLabel = c.notes
      ? ` | Obs: ${sanitizeContextText(c.notes, 120)}`
      : '';
    lines.push(
      `- ${sanitizeContextText(c.fullName, 80)} | Objeto: ${sanitizeContextText(c.caseType, 70)} | ${processLabel} | ${sanitizeContextText(c.driveStage, 50)} | ${c.modality} | Situação: ${totals.situacao} (${totals.paidCount}/${totals.totalInstallmentsCount} parcelas) | Contratado: ${formatCurrencyBRL(totals.totalContratado)} | Pago: ${formatCurrencyBRL(totals.totalPago)} | Restante: ${formatCurrencyBRL(totals.saldoRestante)}${notesLabel} | Arquivos Drive: ${filesLabel}`
    );
  }

  if (calendarEvents.length > 0) {
    lines.push('');
    lines.push('EVENTOS NA AGENDA (referência 13h30–14h30):');
    for (const ev of calendarEvents.slice(0, 25)) {
      lines.push(
        `- ${sanitizeContextText(ev.titulo ?? 'Evento', 90)} | Início: ${sanitizeContextText(ev.inicio ?? '', 40)} | Desc: ${sanitizeContextText(ev.descricao ?? '', 120)}`
      );
    }
    if (calendarEvents.length > 25) {
      lines.push(`... e mais ${calendarEvents.length - 25} evento(s) na agenda.`);
    }
  }

  return clampContextBudget(lines, MAX_PORTFOLIO_CONTEXT_CHARS);
}

export function buildDocumentAnalysisPrompt(
  clientName: string,
  fileName: string
): string {
  return [
    `${ASSISTANT_NAME}, analise o documento "${fileName}" da cliente ${clientName}.`,
    'Por favor, extraia e organize em tópicos objetivos apenas o que constar no documento:',
    '1. Número do processo e objeto do contrato / tipo de ação (se constar no documento);',
    '2. Datas importantes (decisão, protocolo, assinatura, audiência ou prazos);',
    '3. Valores de honorários (total contratado, entrada, parcelas e percentual de êxito, se houver);',
    '4. Regras de vencimento e forma de pagamento;',
    '5. Sugestões práticas do que deve ser atualizado na planilha de honorários ou na agenda (13h30 às 14h30).',
  ].join('\n');
}

const DOC_INTENT_KEYWORDS = [
  'analis',
  'leia',
  'ler',
  'extrai',
  'contrato',
  'decisao',
  'sentenca',
  'protocolo',
  'procuracao',
  'peticao',
  'documento',
  'arquivo',
  'pdf',
  'acordo',
  'comprovante',
];

const DOC_TYPE_KEYWORDS = [
  'contrato',
  'decisao',
  'sentenca',
  'protocolo',
  'procuracao',
  'peticao',
  'acordo',
  'comprovante',
  'despacho',
  'termo',
  'inicial',
  'emenda',
  'recibo',
];

export function findDocumentReferenceInQuery(
  query: string,
  clients: ClientCase[]
): { client: ClientCase; file: DriveFileItem } | null {
  const normQuery = normalizeText(query);
  if (!normQuery) return null;

  const hasDocIntent = DOC_INTENT_KEYWORDS.some((kw) => normQuery.includes(kw));
  if (!hasDocIntent) return null;

  // Score clients mentioned in the query
  let bestClient: ClientCase | null = null;
  let bestClientScore = 0;

  for (const client of clients) {
    if (!client.driveFiles || client.driveFiles.length === 0) continue;
    const normName = normalizeText(client.fullName);
    if (!normName) continue;

    if (normQuery.includes(normName)) {
      bestClient = client;
      bestClientScore = 1000 + normName.length;
      break;
    }

    const tokens = normName
      .split(' ')
      .filter(
        (t) =>
          t.length >= 3 && !['dos', 'das', 'silva', 'souza', 'santos'].includes(t)
      );
    const fullTokens = normName.split(' ').filter((t) => t.length >= 3);
    const matchedTokens = fullTokens.filter((t) => normQuery.includes(t));

    // Require either >=2 matching name tokens OR >=1 distinctive first/surname token (>=4 chars)
    const distinctiveHits = tokens.filter((t) => normQuery.includes(t));
    if (
      matchedTokens.length >= 2 ||
      (distinctiveHits.length >= 1 && fullTokens.length <= 2)
    ) {
      const score = matchedTokens.length * 10 + distinctiveHits.length * 5;
      if (score > bestClientScore) {
        bestClientScore = score;
        bestClient = client;
      }
    }
  }

  if (
    !bestClient ||
    !bestClient.driveFiles ||
    bestClient.driveFiles.length === 0
  ) {
    return null;
  }

  // Pick the most relevant file inside that client's Drive folder
  const requestedKeywords = DOC_TYPE_KEYWORDS.filter((kw) =>
    normQuery.includes(kw)
  );

  let bestFile = bestClient.driveFiles[0];
  let bestFileScore = -1;

  for (const file of bestClient.driveFiles) {
    const normFileName = normalizeText(file.nome);
    let score = 0;
    for (const kw of requestedKeywords) {
      if (normFileName.includes(kw)) score += 20;
    }
    if (file.mimeType.includes('pdf')) score += 5;
    if (normFileName.includes('contrato')) score += 2;
    if (score > bestFileScore) {
      bestFileScore = score;
      bestFile = file;
    }
  }

  return { client: bestClient, file: bestFile };
}
