import {
  AppsScriptCalendarEventRow,
  ClientCase,
  DriveFileItem,
  ZapSignCrossReferenceItem,
} from '../types/honorarios';
import {
  addDaysISO,
  calculateClientTotals,
  calculateDashboardKPIs,
  flattenInstallments,
  formatCurrencyBRL,
  formatDateBR,
  getAttentionTodayList,
} from './honorariosLogic';
import { normalizeText } from './sheetArchitecture';

export interface AssistantContextExtras {
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
}

export function buildPortfolioContextSummary(
  clients: ClientCase[],
  calendarEvents: AppsScriptCalendarEventRow[],
  todayISO: string,
  extras?: AssistantContextExtras
): string {
  const kpis = calculateDashboardKPIs(clients, todayISO);
  const attention = getAttentionTodayList(clients, todayISO);
  const weekEnd = addDaysISO(todayISO, 7);
  const allInstallments = flattenInstallments(clients, todayISO);
  const upcomingWeek = allInstallments
    .filter(
      (i) => i.status !== 'Paga' && i.dueDate > todayISO && i.dueDate <= weekEnd
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const lines: string[] = [
    `Data de referência: ${formatDateBR(todayISO)} (${todayISO})`,
    `Total de clientes na carteira: ${clients.length}`,
    `KPIs do mês atual (${kpis.selectedMonthKey}): Total a Receber ${formatCurrencyBRL(kpis.totalAReceber)} | Recebido no mês ${formatCurrencyBRL(kpis.recebidoNoMes)} | Previsto no mês ${formatCurrencyBRL(kpis.previstoNoMes)} | Ticket médio ${formatCurrencyBRL(kpis.ticketMedioCarteira)} | Taxa de adimplência ${kpis.taxaAdimplencia.toFixed(1)}% | Em atraso ${kpis.parcelasEmAtrasoCount} parcela(s) (${formatCurrencyBRL(kpis.parcelasEmAtrasoValor)}) | Vencimentos próximos 7 dias ${kpis.vencimentosSemanaCount} parcela(s) (${formatCurrencyBRL(kpis.vencimentosSemanaValor)})`,
    '',
    'ATENÇÃO HOJE (Atrasadas ou vencendo hoje):',
  ];

  if (attention.length === 0) {
    lines.push('- Nenhuma parcela vencida ou vencendo hoje.');
  } else {
    for (const item of attention.slice(0, 40)) {
      lines.push(
        `- ${item.clientName} | Tel: ${item.clientPhone} | Objeto: ${item.caseType} | Parcela ${item.installmentNumber}/${item.totalInstallments} | Valor: ${formatCurrencyBRL(item.amount)} | Venc: ${formatDateBR(item.dueDate)} | Status: ${item.status}`
      );
    }
    if (attention.length > 40) {
      lines.push(`... e mais ${attention.length - 40} pendência(s).`);
    }
  }

  lines.push('');
  lines.push('VENCIMENTOS DOS PRÓXIMOS 7 DIAS:');
  if (upcomingWeek.length === 0) {
    lines.push('- Nenhum vencimento nos próximos 7 dias.');
  } else {
    for (const item of upcomingWeek.slice(0, 30)) {
      lines.push(
        `- ${item.clientName} | Parcela ${item.installmentNumber}/${item.totalInstallments} | Valor: ${formatCurrencyBRL(item.amount)} | Venc: ${formatDateBR(item.dueDate)}`
      );
    }
    if (upcomingWeek.length > 30) {
      lines.push(`... e mais ${upcomingWeek.length - 30} parcela(s) na semana.`);
    }
  }

  if (extras?.goalsByMonth || extras?.simulatorInputs || extras?.simulatorOutputs) {
    lines.push('');
    lines.push('METAS MENSAIS & SIMULADOR DE PROJEÇÕES (ADS):');
    const currentMonthKey = todayISO.slice(0, 7);
    const currentGoal =
      extras.goalsByMonth?.[currentMonthKey] ?? extras.defaultGoal ?? 25000;
    lines.push(`- Meta configurada para o mês atual (${currentMonthKey}): ${formatCurrencyBRL(currentGoal)}`);
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
    lines.push(`DOCUMENTOS ASSINADOS NO ZAPSIGN (${extras.zapSignDocs.length} total, somente status signed):`);
    if (extras.zapSignDocs.length === 0) {
      lines.push('- Nenhum documento assinado carregado do ZapSign.');
    } else {
      for (const doc of extras.zapSignDocs.slice(0, 40)) {
        const signersLabel = doc.signers
          .map((s) => `${s.name}${s.email ? ` (${s.email})` : ''}`)
          .join(', ');
        lines.push(
          `- [Token: ${doc.token}] ${doc.name} | Assinado em: ${doc.signedAt} | Signatários: ${signersLabel || 'Não informado'}`
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
            ? `Pasta no Drive: ${item.driveFolder.etapa}`
            : 'Sem pasta no Drive';
          lines.push(
            `- ALERTA AUDITORIA: Signatário ${item.primarySignerName} | Doc: "${item.doc.name}" (Assinado em ${item.doc.signedAt}) | ${driveLabel}`
          );
        }
      } else if (extras.unmatchedZapSignDocs && extras.unmatchedZapSignDocs.length > 0) {
        lines.push(
          `CONTRATOS ASSINADOS NO ZAPSIGN QUE NÃO CONSTAM NA PLANILHA (${extras.unmatchedZapSignDocs.length}):`
        );
        for (const u of extras.unmatchedZapSignDocs.slice(0, 25)) {
          lines.push(
            `- ALERTA AUDITORIA: "${u.name}" (Assinado em ${u.signedAt}) | Signatários: ${u.signers.map((s) => s.name).join(', ')}`
          );
        }
      } else {
        lines.push('- Auditoria ZapSign × Planilha × Drive: todos os documentos assinados ativos possuem correspondência na planilha (itens em ZZ - Encerrados marcados como Encerrado (não cobrar)).');
      }
    }
  }

  lines.push('');
  lines.push('CLIENTES, PROCESSO, OBJETO, SITUAÇÃO E ARQUIVOS NO GOOGLE DRIVE:');
  for (const c of clients) {
    const totals = calculateClientTotals(c, todayISO);
    const filesLabel =
      c.driveFiles && c.driveFiles.length > 0
        ? c.driveFiles
            .map((f) => `[id:${f.id}] ${f.nome} (${f.mimeType})`)
            .join('; ')
        : 'sem arquivos listados';
    const processLabel = c.processNumber ? `Processo: ${c.processNumber}` : 'Sem nº de processo informado';
    const notesLabel = c.notes ? ` | Obs: ${c.notes}` : '';
    lines.push(
      `- ${c.fullName} | Objeto: ${c.caseType} | ${processLabel} | ${c.driveStage} | ${c.modality} | Situação: ${totals.situacao} (${totals.paidCount}/${totals.totalInstallmentsCount} parcelas) | Contratado: ${formatCurrencyBRL(totals.totalContratado)} | Pago: ${formatCurrencyBRL(totals.totalPago)} | Restante: ${formatCurrencyBRL(totals.saldoRestante)}${notesLabel} | Arquivos Drive: ${filesLabel}`
    );
  }

  if (calendarEvents.length > 0) {
    lines.push('');
    lines.push('EVENTOS NA AGENDA (referência 13h30–14h30):');
    for (const ev of calendarEvents.slice(0, 30)) {
      lines.push(
        `- ${ev.titulo ?? 'Evento'} | Início: ${ev.inicio ?? ''} | Desc: ${ev.descricao ?? ''}`
      );
    }
  }

  return lines.join('\n');
}

export function buildDocumentAnalysisPrompt(
  clientName: string,
  fileName: string
): string {
  return [
    `Analise o documento "${fileName}" da cliente ${clientName}.`,
    'Por favor, extraia e organize em tópicos objetivos:',
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
      .filter((t) => t.length >= 3 && !['dos', 'das', 'silva', 'souza', 'santos'].includes(t));
    const fullTokens = normName.split(' ').filter((t) => t.length >= 3);
    const matchedTokens = fullTokens.filter((t) => normQuery.includes(t));

    // Require either >=2 matching name tokens OR >=1 distinctive first/surname token (>=4 chars)
    const distinctiveHits = tokens.filter((t) => normQuery.includes(t));
    if (matchedTokens.length >= 2 || (distinctiveHits.length >= 1 && fullTokens.length <= 2)) {
      const score = matchedTokens.length * 10 + distinctiveHits.length * 5;
      if (score > bestClientScore) {
        bestClientScore = score;
        bestClient = client;
      }
    }
  }

  if (!bestClient || !bestClient.driveFiles || bestClient.driveFiles.length === 0) {
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
