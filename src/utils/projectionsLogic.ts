import {
  ClientCase,
  PortfolioBaseline,
  ProjectionChartPoint,
  SimulatorInputs,
  SimulatorOutputs,
  SimulatorPresetId,
} from '../types/honorarios';
import { flattenInstallments } from './honorariosLogic';

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

export const DEFAULT_MONTHLY_GOAL = 25000;

export function getMonthSequence(
  centerMonthKey: string,
  monthsBefore: number,
  monthsAfter: number
): Array<{ monthKey: string; label: string; offset: number }> {
  const [y, m] = centerMonthKey.split('-').map(Number);
  const result: Array<{ monthKey: string; label: string; offset: number }> = [];
  for (let offset = -monthsBefore; offset <= monthsAfter; offset++) {
    const dt = new Date(Date.UTC(y, m - 1 + offset, 1));
    const yr = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const monthKey = `${yr}-${String(mo).padStart(2, '0')}`;
    const label = `${MONTH_ABBR_PT[mo - 1]}/${String(yr).slice(2)}`;
    result.push({ monthKey, label, offset });
  }
  return result;
}

export function computePortfolioBaseline(
  clients: ClientCase[],
  todayISO: string
): PortfolioBaseline {
  const fixedClients = clients.filter(
    (c) => c.modality !== 'Êxito 30%' && c.contractedTotal > 0
  );
  const ticketSource =
    fixedClients.length > 0
      ? fixedClients
      : clients.filter((c) => c.contractedTotal > 0);

  const averageTicket =
    ticketSource.length > 0
      ? Math.round(
          ticketSource.reduce((sum, c) => sum + c.contractedTotal, 0) /
            ticketSource.length
        )
      : 2000;

  const parceladoCounts = fixedClients
    .filter((c) => c.modality === 'Parcelado' && c.installments.length > 0)
    .map((c) => c.installments.length);

  const averageInstallments =
    parceladoCounts.length > 0
      ? Math.max(
          1,
          Math.min(
            24,
            Math.round(
              parceladoCounts.reduce((s, n) => s + n, 0) /
                parceladoCounts.length
            )
          )
        )
      : 10;

  const allInstallments = flattenInstallments(clients, todayISO);
  const dueUpToToday = allInstallments.filter((i) => i.dueDate <= todayISO);
  const overdueCount = dueUpToToday.filter((i) => i.status === 'Atrasada').length;

  const observedDefaultPct =
    dueUpToToday.length > 0
      ? Math.min(
          60,
          Math.max(0, Math.round((overdueCount / dueUpToToday.length) * 1000) / 10)
        )
      : 8;

  return {
    averageTicket,
    averageInstallments,
    observedDefaultPct,
    fixedContractsCount: fixedClients.length,
  };
}

export function getPresetSimulatorInputs(
  preset: SimulatorPresetId,
  baseline: PortfolioBaseline
): SimulatorInputs {
  const ticket = baseline.averageTicket > 0 ? baseline.averageTicket : 2000;
  const parcelas =
    baseline.averageInstallments > 0 ? baseline.averageInstallments : 10;
  const baseDefault =
    baseline.observedDefaultPct > 0
      ? Math.min(35, Math.round(baseline.observedDefaultPct))
      : 8;

  if (preset === 'conservador') {
    return {
      monthlyAdsSpend: 2500,
      costPerLead: 45,
      conversionRatePct: 8,
      averageTicket: ticket,
      averageInstallments: parcelas,
      estimatedDefaultPct: Math.max(8, baseDefault),
    };
  }

  if (preset === 'expansao') {
    return {
      monthlyAdsSpend: 8500,
      costPerLead: 38,
      conversionRatePct: 15,
      averageTicket: Math.round(ticket * 1.1),
      averageInstallments: parcelas,
      estimatedDefaultPct: Math.max(5, Math.round(baseDefault * 0.85)),
    };
  }

  // 'meta'
  return {
    monthlyAdsSpend: 4500,
    costPerLead: 40,
    conversionRatePct: 12,
    averageTicket: ticket,
    averageInstallments: parcelas,
    estimatedDefaultPct: baseDefault,
  };
}

export function calculateSimulatorOutputs(
  inputs: SimulatorInputs
): SimulatorOutputs {
  const ads = Math.max(0, inputs.monthlyAdsSpend);
  const cpl = Math.max(0, inputs.costPerLead);
  const conv = Math.min(100, Math.max(0, inputs.conversionRatePct));
  const ticket = Math.max(0, inputs.averageTicket);
  const parcelas = Math.max(1, Math.round(inputs.averageInstallments || 1));
  const defaultRate = Math.min(100, Math.max(0, inputs.estimatedDefaultPct));

  const estimatedLeads = cpl > 0 ? ads / cpl : 0;
  const closedContractsPerMonth = estimatedLeads * (conv / 100);
  const grossContractedRevenue = closedContractsPerMonth * ticket;
  const addedMonthlyRecurringRevenue = grossContractedRevenue / parcelas;
  const netCashAfterDefault =
    grossContractedRevenue * (1 - defaultRate / 100);
  const projectedRoiPct =
    ads > 0 ? ((netCashAfterDefault - ads) / ads) * 100 : 0;
  const roiMultiple = ads > 0 ? netCashAfterDefault / ads : 0;

  return {
    estimatedLeads,
    closedContractsPerMonth,
    grossContractedRevenue,
    addedMonthlyRecurringRevenue,
    netCashAfterDefault,
    projectedRoiPct,
    roiMultiple,
  };
}

export function buildProjectionsChartData(
  clients: ClientCase[],
  goalsByMonth: Record<string, number>,
  inputs: SimulatorInputs,
  outputs: SimulatorOutputs,
  currentMonthKey: string,
  defaultGoal: number = DEFAULT_MONTHLY_GOAL
): ProjectionChartPoint[] {
  const months = getMonthSequence(currentMonthKey, 3, 6);
  const parcelas = Math.max(1, Math.round(inputs.averageInstallments || 1));
  const defaultMultiplier =
    1 - Math.min(100, Math.max(0, inputs.estimatedDefaultPct)) / 100;

  return months.map(({ monthKey, label, offset }) => {
    let previsto = 0;
    let recebido = 0;

    for (const client of clients) {
      for (const inst of client.installments) {
        if (inst.dueDate.startsWith(monthKey)) {
          previsto += inst.amount;
        }
        if (inst.paidDate && inst.paidDate.startsWith(monthKey)) {
          recebido += inst.amount;
        }
      }
    }

    const meta =
      typeof goalsByMonth[monthKey] === 'number' &&
      Number.isFinite(goalsByMonth[monthKey])
        ? Math.max(0, goalsByMonth[monthKey])
        : defaultGoal;

    // For current and future months (offset >= 0), simulate stacking recurring installments
    // from new Ads-acquired cohorts signed each month starting at offset 0.
    const activeCohorts = offset >= 0 ? Math.min(offset + 1, parcelas) : 0;
    const simulatedRecurringNet =
      activeCohorts * outputs.addedMonthlyRecurringRevenue * defaultMultiplier;

    const projecao =
      offset >= 0 ? Math.round(previsto + simulatedRecurringNet) : 0;

    return {
      monthKey,
      label,
      meta: Math.round(meta),
      previsto: Math.round(previsto),
      recebido: Math.round(recebido),
      projecao,
    };
  });
}
