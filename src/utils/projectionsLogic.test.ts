import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectionsChartData,
  calculateSimulatorOutputs,
  computePortfolioBaseline,
  DEFAULT_MONTHLY_GOAL,
  getMonthSequence,
  getPresetSimulatorInputs,
} from './projectionsLogic';
import { createDemoClients } from '../data/demoData';

const TODAY = '2026-11-14';

test('getMonthSequence builds ordered recent + upcoming month window', () => {
  const seq = getMonthSequence('2026-11', 3, 6);
  assert.equal(seq.length, 10);
  assert.equal(seq[0].monthKey, '2026-08');
  assert.equal(seq[3].monthKey, '2026-11');
  assert.equal(seq[9].monthKey, '2027-05');
});

test('computePortfolioBaseline extracts realistic ticket, installments, and default rate from portfolio', () => {
  const clients = createDemoClients(TODAY);
  const baseline = computePortfolioBaseline(clients, TODAY);
  assert.ok(baseline.averageTicket > 0);
  assert.ok(baseline.averageInstallments >= 1 && baseline.averageInstallments <= 24);
  assert.ok(baseline.observedDefaultPct >= 0 && baseline.observedDefaultPct <= 60);
  assert.ok(baseline.fixedContractsCount > 0);
});

test('getPresetSimulatorInputs and calculateSimulatorOutputs compute funnel, cash, and ROI accurately', () => {
  const baseline = {
    averageTicket: 2500,
    averageInstallments: 10,
    observedDefaultPct: 10,
    fixedContractsCount: 8,
  };

  const conservador = getPresetSimulatorInputs('conservador', baseline);
  const meta = getPresetSimulatorInputs('meta', baseline);
  const expansao = getPresetSimulatorInputs('expansao', baseline);

  assert.ok(conservador.monthlyAdsSpend < meta.monthlyAdsSpend);
  assert.ok(meta.monthlyAdsSpend < expansao.monthlyAdsSpend);
  assert.equal(meta.averageInstallments, 10);

  const outputs = calculateSimulatorOutputs({
    monthlyAdsSpend: 4000,
    costPerLead: 40,
    conversionRatePct: 10,
    averageTicket: 2500,
    averageInstallments: 10,
    estimatedDefaultPct: 10,
  });

  assert.equal(outputs.estimatedLeads, 100);
  assert.equal(outputs.closedContractsPerMonth, 10);
  assert.equal(outputs.grossContractedRevenue, 25000);
  assert.equal(outputs.addedMonthlyRecurringRevenue, 2500);
  assert.equal(outputs.netCashAfterDefault, 22500);
  assert.equal(outputs.roiMultiple, 22500 / 4000);
});

test('buildProjectionsChartData returns 10 points with goals and growing simulated projection', () => {
  const clients = createDemoClients(TODAY);
  const baseline = computePortfolioBaseline(clients, TODAY);
  const inputs = getPresetSimulatorInputs('meta', baseline);
  const outputs = calculateSimulatorOutputs(inputs);

  const chart = buildProjectionsChartData(
    clients,
    { '2026-11': 32000, '2026-12': 35000 },
    inputs,
    outputs,
    '2026-11',
    DEFAULT_MONTHLY_GOAL
  );

  assert.equal(chart.length, 10);
  const aug = chart.find((p) => p.monthKey === '2026-08');
  const nov = chart.find((p) => p.monthKey === '2026-11');
  const dec = chart.find((p) => p.monthKey === '2026-12');

  assert.ok(aug && aug.projecao === 0);
  assert.ok(nov && nov.meta === 32000 && nov.projecao >= nov.previsto);
  assert.ok(dec && dec.meta === 35000 && dec.projecao >= dec.previsto);
});
