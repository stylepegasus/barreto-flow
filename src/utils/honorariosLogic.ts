import type {
  AppsScriptDashboardSnapshot,
  AppsScriptPaymentRow,
  BillingDaySummary,
  ClientCase,
  ClientTotals,
  DashboardKPIs,
  DriveStage,
  Installment,
  InstallmentStatus,
  InstallmentWithStatus,
  MonthlyChartPoint,
  PaymentModality,
} from '../types/honorarios.ts';
import { fromCents, toCents } from './sheetArchitecture.ts';

const MONTH_ABBR_PT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

export const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export function getTodayISO(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCurrencyCompactBRL(value: number): string {
  const isWhole = Math.abs(value - Math.round(value)) < 0.001;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  }).format(value);
}

export function formatDateBR(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function computeInstallmentStatus(
  installment: { paidDate?: string; dueDate: string },
  todayISO: string
): InstallmentStatus {
  if (installment.paidDate) {
    return 'Paga';
  }
  if (installment.dueDate < todayISO) {
    return 'Atrasada';
  }
  return 'Em dia';
}

function getInstallmentRemainingCents(
  inst: Pick<Installment, 'amount' | 'paidDate' | 'remainingAmount'>
): number {
  if (inst.remainingAmount !== undefined && Number.isFinite(inst.remainingAmount)) {
    return Math.max(0, toCents(inst.remainingAmount));
  }
  return inst.paidDate ? 0 : Math.max(0, toCents(inst.amount));
}

function getInstallmentReceivedCents(
  inst: Pick<Installment, 'amount' | 'paidDate' | 'receivedAmount'>
): number {
  if (inst.receivedAmount !== undefined && Number.isFinite(inst.receivedAmount)) {
    return Math.max(0, toCents(inst.receivedAmount));
  }
  return inst.paidDate ? Math.max(0, toCents(inst.amount)) : 0;
}

function resolvePaymentMonthKey(pay: AppsScriptPaymentRow): string | undefined {
  if (pay.mesRecebido && /^\d{4}-\d{2}/.test(pay.mesRecebido)) {
    return pay.mesRecebido.slice(0, 7);
  }
  if (pay.dataPagamento && /^\d{4}-\d{2}/.test(pay.dataPagamento)) {
    return pay.dataPagamento.slice(0, 7);
  }
  return undefined;
}

function resolvePaymentAmountCents(pay: AppsScriptPaymentRow): number {
  const rawVal =
    pay.valorAtivo !== undefined && pay.valorAtivo !== ''
      ? Number(pay.valorAtivo)
      : Number(pay.valor ?? 0);
  if (!Number.isFinite(rawVal) || rawVal <= 0) return 0;
  return toCents(rawVal);
}

export interface DashboardSSOTOptions {
  officialDashboard?: AppsScriptDashboardSnapshot | null;
  payments?: AppsScriptPaymentRow[];
}

export function flattenInstallments(
  clients: ClientCase[],
  todayISO: string
): InstallmentWithStatus[] {
  const list: InstallmentWithStatus[] = [];
  for (const client of clients) {
    if (client.isCanceled) continue;
    for (const inst of client.installments) {
      list.push({
        ...inst,
        status: computeInstallmentStatus(inst, todayISO),
        clientPhone: client.phone,
        caseType: client.caseType,
        driveStage: client.driveStage,
        modality: client.modality,
      });
    }
  }
  return list;
}

export function calculateDashboardKPIs(
  clients: ClientCase[],
  todayISO: string,
  selectedMonthKey?: string,
  ssotOptions?: DashboardSSOTOptions
): DashboardKPIs {
  const all = flattenInstallments(clients, todayISO);
  const currentMonthPrefix = todayISO.slice(0, 7);
  const effectiveMonthKey =
    selectedMonthKey && /^\d{4}-\d{2}$/.test(selectedMonthKey)
      ? selectedMonthKey
      : currentMonthPrefix;
  const isCurrentMonth = effectiveMonthKey === currentMonthPrefix;
  const weekEndISO = addDaysISO(todayISO, 7);

  let saldoParcelasDatadasCents = 0;
  let recebidoNoMesInstallmentsCents = 0;
  let totalJaRecebidoInstallmentsCents = 0;
  let previstoNoMesCents = 0;
  let faltaNoMesCents = 0;
  let parcelasEmAtrasoCount = 0;
  let parcelasEmAtrasoCents = 0;
  let vencimentosSemanaCount = 0;
  let vencimentosSemanaCents = 0;

  let dueForAdimplenciaCount = 0;
  let paidForAdimplenciaCount = 0;

  for (const item of all) {
    const amountCents = Math.max(0, toCents(item.amount));
    const remainingCents = getInstallmentRemainingCents(item);
    const receivedCents = getInstallmentReceivedCents(item);

    if (item.dueDate.startsWith(effectiveMonthKey)) {
      previstoNoMesCents += amountCents;
      faltaNoMesCents += remainingCents;
    }

    if (receivedCents > 0) {
      totalJaRecebidoInstallmentsCents += receivedCents;
      const effectivePaidMonth = (
        item.paidDate ??
        item.lastPaymentDate ??
        item.dueDate
      ).slice(0, 7);
      if (effectivePaidMonth === effectiveMonthKey) {
        recebidoNoMesInstallmentsCents += receivedCents;
      }
    }

    if (remainingCents > 0) {
      saldoParcelasDatadasCents += remainingCents;
      if (item.status === 'Atrasada') {
        if (isCurrentMonth || item.dueDate.startsWith(effectiveMonthKey)) {
          parcelasEmAtrasoCount += 1;
          parcelasEmAtrasoCents += remainingCents;
        }
      }
      if (item.dueDate >= todayISO && item.dueDate <= weekEndISO) {
        vencimentosSemanaCount += 1;
        vencimentosSemanaCents += remainingCents;
      }
    }

    const countsTowardMonthAdimplencia = isCurrentMonth
      ? item.dueDate <= todayISO
      : item.dueDate.startsWith(effectiveMonthKey) && item.dueDate <= todayISO;

    if (countsTowardMonthAdimplencia) {
      dueForAdimplenciaCount += 1;
      if (item.status === 'Paga') {
        paidForAdimplenciaCount += 1;
      }
    }
  }

  let saldoSemDataCents = 0;
  let creditoAVincularCents = 0;
  let sheetTotalPaidSumCents = 0;
  let hasAnySheetTotalPaid = false;
  const contractedValuesCents: number[] = [];

  for (const client of clients) {
    if (client.isCanceled) continue;
    saldoSemDataCents += Math.max(0, toCents(client.undatedBalance ?? 0));
    creditoAVincularCents += Math.max(0, toCents(client.unlinkedCredit ?? 0));
    if (
      client.sheetTotalPaid !== undefined &&
      Number.isFinite(client.sheetTotalPaid)
    ) {
      hasAnySheetTotalPaid = true;
      sheetTotalPaidSumCents += Math.max(0, toCents(client.sheetTotalPaid));
    }
    if (Number.isFinite(client.contractedTotal) && client.contractedTotal > 0) {
      contractedValuesCents.push(toCents(client.contractedTotal));
    }
  }

  const totalAReceberCents = saldoParcelasDatadasCents + saldoSemDataCents;

  // Authoritative cash received from official Pagamentos tab when available
  const payments = Array.isArray(ssotOptions?.payments)
    ? ssotOptions.payments
    : [];
  const hasPaymentsLedger = payments.length > 0;

  let recebidoNoMesCents = recebidoNoMesInstallmentsCents;
  let totalJaRecebidoCents = hasAnySheetTotalPaid
    ? Math.max(
        sheetTotalPaidSumCents,
        totalJaRecebidoInstallmentsCents + creditoAVincularCents
      )
    : totalJaRecebidoInstallmentsCents + creditoAVincularCents;

  if (hasPaymentsLedger) {
    let ledgerTotalCents = 0;
    let ledgerMonthCents = 0;
    for (const pay of payments) {
      const amtCents = resolvePaymentAmountCents(pay);
      if (amtCents <= 0) continue;
      ledgerTotalCents += amtCents;
      if (resolvePaymentMonthKey(pay) === effectiveMonthKey) {
        ledgerMonthCents += amtCents;
      }
    }
    totalJaRecebidoCents = ledgerTotalCents;
    recebidoNoMesCents = ledgerMonthCents;
  } else if (ssotOptions?.officialDashboard?.fromOfficialSheetTab) {
    const dash = ssotOptions.officialDashboard;
    if (Number.isFinite(dash.totalJaRecebido) && dash.totalJaRecebido >= 0) {
      totalJaRecebidoCents = toCents(dash.totalJaRecebido);
    }
    if (
      dash.mesReferencia === effectiveMonthKey &&
      Number.isFinite(dash.recebidoNoMes) &&
      dash.recebidoNoMes >= 0
    ) {
      recebidoNoMesCents = toCents(dash.recebidoNoMes);
    }
  }

  const ticketMedioCarteira =
    contractedValuesCents.length > 0
      ? fromCents(
          Math.round(
            contractedValuesCents.reduce((sum, v) => sum + v, 0) /
              contractedValuesCents.length
          )
        )
      : 0;

  const taxaAdimplencia =
    dueForAdimplenciaCount > 0
      ? Math.round((paidForAdimplenciaCount / dueForAdimplenciaCount) * 1000) /
        10
      : 100;

  return {
    totalAReceber: fromCents(totalAReceberCents),
    saldoParcelasDatadas: fromCents(saldoParcelasDatadasCents),
    saldoSemData: fromCents(saldoSemDataCents),
    creditoAVincular: fromCents(creditoAVincularCents),
    totalJaRecebido: fromCents(totalJaRecebidoCents),
    faltaNoMes: fromCents(faltaNoMesCents),
    isOfficialDashboardSource: Boolean(
      hasPaymentsLedger || ssotOptions?.officialDashboard?.fromOfficialSheetTab
    ),
    recebidoNoMes: fromCents(recebidoNoMesCents),
    previstoNoMes: fromCents(previstoNoMesCents),
    parcelasEmAtrasoCount,
    parcelasEmAtrasoValor: fromCents(parcelasEmAtrasoCents),
    vencimentosSemanaCount,
    vencimentosSemanaValor: fromCents(vencimentosSemanaCents),
    ticketMedioCarteira,
    taxaAdimplencia,
    selectedMonthKey: effectiveMonthKey,
  };
}

export function getAvailableMonthOptions(
  clients: ClientCase[],
  todayISO: string,
  payments?: AppsScriptPaymentRow[]
): Array<{ monthKey: string; label: string }> {
  const [baseY, baseM] = todayISO.slice(0, 7).split('-').map(Number);
  const monthKeys = new Set<string>();

  for (let offset = -5; offset <= 6; offset++) {
    const dt = new Date(Date.UTC(baseY, baseM - 1 + offset, 1));
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    monthKeys.add(`${y}-${m}`);
  }

  for (const client of clients) {
    for (const inst of client.installments) {
      if (inst.dueDate && /^\d{4}-\d{2}/.test(inst.dueDate)) {
        monthKeys.add(inst.dueDate.slice(0, 7));
      }
      if (inst.paidDate && /^\d{4}-\d{2}/.test(inst.paidDate)) {
        monthKeys.add(inst.paidDate.slice(0, 7));
      }
      if (inst.lastPaymentDate && /^\d{4}-\d{2}/.test(inst.lastPaymentDate)) {
        monthKeys.add(inst.lastPaymentDate.slice(0, 7));
      }
    }
  }

  if (Array.isArray(payments)) {
    for (const pay of payments) {
      const mk = resolvePaymentMonthKey(pay);
      if (mk) monthKeys.add(mk);
    }
  }

  return Array.from(monthKeys)
    .sort()
    .map((monthKey) => {
      const [y, m] = monthKey.split('-').map(Number);
      return {
        monthKey,
        label: `${MONTH_NAMES_PT[m - 1]} de ${y}`,
      };
    });
}

export function calculateMonthlyChartData(
  clients: ClientCase[],
  referenceYear: number,
  referenceMonth: number, // 1-12
  payments?: AppsScriptPaymentRow[]
): MonthlyChartPoint[] {
  const hasPaymentsLedger = Array.isArray(payments) && payments.length > 0;
  const ledgerByMonthCents = new Map<string, number>();
  if (hasPaymentsLedger) {
    for (const pay of payments!) {
      const mk = resolvePaymentMonthKey(pay);
      if (!mk) continue;
      const amtCents = resolvePaymentAmountCents(pay);
      if (amtCents <= 0) continue;
      ledgerByMonthCents.set(mk, (ledgerByMonthCents.get(mk) ?? 0) + amtCents);
    }
  }

  const points: MonthlyChartPoint[] = [];
  // Build 6-month window: 4 months prior, reference month, 1 month ahead
  for (let offset = -4; offset <= 1; offset++) {
    const date = new Date(Date.UTC(referenceYear, referenceMonth - 1 + offset, 1));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const monthKey = `${y}-${String(m).padStart(2, '0')}`;
    const label = `${MONTH_ABBR_PT[m - 1]}/${String(y).slice(2)}`;

    let previstoCents = 0;
    let recebidoCents = 0;

    for (const client of clients) {
      if (client.isCanceled) continue;
      for (const inst of client.installments) {
        if (inst.dueDate.startsWith(monthKey)) {
          previstoCents += Math.max(0, toCents(inst.amount));
        }
        if (!hasPaymentsLedger) {
          const recCents = getInstallmentReceivedCents(inst);
          const payDate = inst.paidDate ?? inst.lastPaymentDate;
          if (recCents > 0 && payDate && payDate.startsWith(monthKey)) {
            recebidoCents += recCents;
          }
        }
      }
    }

    if (hasPaymentsLedger) {
      recebidoCents = ledgerByMonthCents.get(monthKey) ?? 0;
    }

    points.push({
      monthKey,
      label,
      previsto: fromCents(previstoCents),
      recebido: fromCents(recebidoCents),
    });
  }

  return points;
}

export function getAttentionTodayList(
  clients: ClientCase[],
  todayISO: string
): InstallmentWithStatus[] {
  const all = flattenInstallments(clients, todayISO);
  return all
    .filter((item) => item.status !== 'Paga' && item.dueDate <= todayISO)
    .sort((a, b) => {
      // Overdue oldest first, then due today, then by name
      if (a.dueDate !== b.dueDate) {
        return a.dueDate.localeCompare(b.dueDate);
      }
      return a.clientName.localeCompare(b.clientName, 'pt-BR');
    });
}

export function groupInstallmentsByBillingDay(
  clients: ClientCase[],
  year: number,
  month: number, // 1-12
  todayISO: string
): BillingDaySummary[] {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const all = flattenInstallments(clients, todayISO).filter((item) =>
    item.dueDate.startsWith(monthPrefix)
  );

  const byDate = new Map<string, InstallmentWithStatus[]>();
  for (const item of all) {
    const existing = byDate.get(item.dueDate) ?? [];
    existing.push(item);
    byDate.set(item.dueDate, existing);
  }

  const summaries: BillingDaySummary[] = [];
  const sortedDates = Array.from(byDate.keys()).sort();

  for (const dateISO of sortedDates) {
    const items = (byDate.get(dateISO) ?? []).sort((a, b) => {
      const rank = (s: InstallmentStatus) => (s === 'Atrasada' ? 0 : s === 'Em dia' ? 1 : 2);
      const diff = rank(a.status) - rank(b.status);
      if (diff !== 0) return diff;
      return a.clientName.localeCompare(b.clientName, 'pt-BR');
    });

    const uniqueClients = new Set(items.map((i) => i.clientId));
    const totalAmount = fromCents(
      items.reduce((sum, i) => sum + Math.max(0, toCents(i.amount)), 0)
    );
    const overdueCount = items.filter((i) => i.status === 'Atrasada').length;
    const paidCount = items.filter((i) => i.status === 'Paga').length;
    const pendingCount = items.length - paidCount;

    summaries.push({
      dateISO,
      dayOfMonth: Number(dateISO.slice(8, 10)),
      clientCount: uniqueClients.size,
      totalAmount,
      overdueCount,
      paidCount,
      pendingCount,
      items,
    });
  }

  return summaries;
}

export function calculateClientTotals(
  client: ClientCase,
  todayISO: string
): ClientTotals {
  const paidInstallments = client.installments.filter((i) => Boolean(i.paidDate));
  const receivedFromInstallmentsCents = client.installments.reduce(
    (sum, i) => sum + getInstallmentReceivedCents(i),
    0
  );
  const totalPagoCents =
    receivedFromInstallmentsCents +
    Math.max(0, toCents(client.unlinkedCredit ?? 0));
  const totalContratadoCents = Math.max(0, toCents(client.contractedTotal));
  const saldoRestanteCents = Math.max(0, totalContratadoCents - totalPagoCents);

  const totalPago = fromCents(totalPagoCents);
  const totalContratado = fromCents(totalContratadoCents);
  const saldoRestante = fromCents(saldoRestanteCents);

  const hasOverdue = client.installments.some(
    (i) => computeInstallmentStatus(i, todayISO) === 'Atrasada'
  );

  let situacao: ClientTotals['situacao'] = 'Em dia';
  if (client.modality === 'Êxito 30%' && client.installments.length === 0) {
    situacao = 'Aguardando êxito';
  } else if (saldoRestante <= 0 && (client.installments.length > 0 || totalPago > 0)) {
    situacao = 'Quitado';
  } else if (hasOverdue) {
    situacao = 'Com atraso';
  } else {
    situacao = 'Em dia';
  }

  return {
    totalContratado,
    totalPago,
    saldoRestante,
    situacao,
    paidCount: paidInstallments.length,
    totalInstallmentsCount: client.installments.length,
  };
}

export function filterClients(
  clients: ClientCase[],
  filters: {
    search: string;
    stage: DriveStage | 'Todas';
    modality: PaymentModality | 'Todas';
  }
): ClientCase[] {
  const query = filters.search.trim().toLowerCase();
  return clients.filter((client) => {
    if (filters.stage !== 'Todas' && client.driveStage !== filters.stage) {
      return false;
    }
    if (filters.modality !== 'Todas' && client.modality !== filters.modality) {
      return false;
    }
    if (query) {
      const haystack = `${client.fullName} ${client.caseType} ${client.processNumber ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
}

export function markInstallmentPaid(
  clients: ClientCase[],
  installmentId: string,
  paidDateISO: string
): ClientCase[] {
  return clients.map((client) => {
    const target = client.installments.find((inst) => inst.id === installmentId);
    if (!target) return client;
    const addedPaidCents = getInstallmentRemainingCents(target);
    return {
      ...client,
      sheetTotalPaid:
        client.sheetTotalPaid !== undefined
          ? fromCents(toCents(client.sheetTotalPaid) + addedPaidCents)
          : undefined,
      installments: client.installments.map((inst) =>
        inst.id === installmentId
          ? {
              ...inst,
              paidDate: paidDateISO,
              lastPaymentDate: paidDateISO,
              receivedAmount: inst.amount,
              remainingAmount: 0,
            }
          : inst
      ),
    };
  });
}

export function rescheduleInstallment(
  clients: ClientCase[],
  installmentId: string,
  newDueDateISO: string
): ClientCase[] {
  return clients.map((client) => ({
    ...client,
    installments: client.installments.map((inst) =>
      inst.id === installmentId ? { ...inst, dueDate: newDueDateISO } : inst
    ),
  }));
}

export function buildWhatsAppMessage(
  clientName: string,
  installmentNumber: number,
  totalInstallments: number,
  amount: number,
  dueDateISO: string,
  isOverdue: boolean
): string {
  const firstName = clientName.trim().split(/\s+/)[0] || clientName;
  const formattedAmount = formatCurrencyBRL(amount);
  const formattedDate = formatDateBR(dueDateISO);
  const parcelaLabel =
    totalInstallments > 1
      ? `parcela ${installmentNumber}/${totalInstallments}`
      : 'parcela única';

  if (isOverdue) {
    return `Olá, ${firstName}! Tudo bem? Aqui é da equipe da Barreto Advocacia Especializada. Passando para lembrar com carinho da ${parcelaLabel} dos seus honorários, no valor de ${formattedAmount}, com vencimento em ${formattedDate}. Caso já tenha realizado o pagamento, por favor nos envie o comprovante por aqui para atualizarmos seu cadastro.`;
  }

  return `Olá, ${firstName}! Tudo bem? Aqui é da equipe da Barreto Advocacia Especializada. Passando para lembrar que a ${parcelaLabel} dos seus honorários, no valor de ${formattedAmount}, vence hoje (${formattedDate}). Qualquer dúvida ou se precisar da chave Pix para o pagamento, estamos à disposição.`;
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function validateAppsScriptUrl(url: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = url.trim();
  if (!trimmed) {
    return { valid: false, error: 'Informe a URL do Web App do Google Apps Script.' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: 'A URL deve começar com https:// (endereço seguro do Google Apps Script).',
      };
    }
    const isGoogleScriptHost =
      parsed.hostname === 'script.google.com' ||
      parsed.hostname === 'script.googleusercontent.com';
    if (!isGoogleScriptHost) {
      return {
        valid: false,
        error:
          'Use uma URL oficial do Google Apps Script (script.google.com/macros/s/...).',
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Endereço inválido. Cole a URL completa copiada do Apps Script.' };
  }
}
