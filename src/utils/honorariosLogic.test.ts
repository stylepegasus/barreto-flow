import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateClientTotals,
  calculateDashboardKPIs,
  calculateMonthlyChartData,
  computeInstallmentStatus,
  filterClients,
  getAttentionTodayList,
  getAvailableMonthOptions,
  groupInstallmentsByBillingDay,
  markInstallmentPaid,
  rescheduleInstallment,
  validateAppsScriptUrl,
} from './honorariosLogic';
import { createDemoClients } from '../data/demoData';

const TODAY = '2026-11-14';

test('computeInstallmentStatus resolves Paga, Atrasada, and Em dia accurately', () => {
  assert.equal(
    computeInstallmentStatus({ dueDate: '2026-11-10', paidDate: '2026-11-10' }, TODAY),
    'Paga'
  );
  assert.equal(
    computeInstallmentStatus({ dueDate: '2026-11-10' }, TODAY),
    'Atrasada'
  );
  assert.equal(
    computeInstallmentStatus({ dueDate: '2026-11-14' }, TODAY),
    'Em dia'
  );
  assert.equal(
    computeInstallmentStatus({ dueDate: '2026-11-20' }, TODAY),
    'Em dia'
  );
});

test('demo dataset has Day 20 grouped with 7 clients totaling R$ 1.400 and populated KPIs', () => {
  const clients = createDemoClients(TODAY);
  const days = groupInstallmentsByBillingDay(clients, 2026, 11, TODAY);

  // Only days with installments are returned
  assert.ok(days.length >= 8);
  for (const day of days) {
    assert.ok(day.items.length > 0);
  }

  const day20 = days.find((d) => d.dayOfMonth === 20);
  assert.ok(day20, 'Day 20 should exist in November demo calendar');
  assert.equal(day20.clientCount, 7);
  assert.equal(day20.totalAmount, 1400);

  const kpis = calculateDashboardKPIs(clients, TODAY);
  assert.ok(kpis.totalAReceber > 0);
  assert.ok(kpis.recebidoNoMes > 0);
  assert.ok(kpis.previstoNoMes > 0);
  assert.ok(kpis.parcelasEmAtrasoCount > 0);
  assert.ok(kpis.vencimentosSemanaCount > 0);
  assert.ok(kpis.ticketMedioCarteira > 0);
  assert.ok(kpis.taxaAdimplencia >= 0 && kpis.taxaAdimplencia <= 100);
  assert.equal(kpis.selectedMonthKey, '2026-11');
});

test('calculateDashboardKPIs filters recebidoNoMes, previstoNoMes, and atraso by selectedMonthKey', () => {
  const clients = createDemoClients(TODAY);
  const novKPIs = calculateDashboardKPIs(clients, TODAY, '2026-11');
  const decKPIs = calculateDashboardKPIs(clients, TODAY, '2026-12');

  assert.equal(novKPIs.selectedMonthKey, '2026-11');
  assert.equal(decKPIs.selectedMonthKey, '2026-12');
  assert.equal(novKPIs.totalAReceber, decKPIs.totalAReceber);
  assert.notEqual(novKPIs.recebidoNoMes, decKPIs.recebidoNoMes);

  const monthOptions = getAvailableMonthOptions(clients, TODAY);
  assert.ok(monthOptions.some((o) => o.monthKey === '2026-11' && o.label === 'Novembro de 2026'));
  assert.ok(monthOptions.some((o) => o.monthKey === '2026-12'));
});

test('markInstallmentPaid updates KPIs and removes item from Attention Today', () => {
  const clients = createDemoClients(TODAY);
  const beforeAttention = getAttentionTodayList(clients, TODAY);
  assert.ok(beforeAttention.length > 0);

  const target = beforeAttention[0];
  const beforeKPIs = calculateDashboardKPIs(clients, TODAY);

  const updatedClients = markInstallmentPaid(clients, target.id, TODAY);
  const afterAttention = getAttentionTodayList(updatedClients, TODAY);
  const afterKPIs = calculateDashboardKPIs(updatedClients, TODAY);

  assert.equal(afterAttention.length, beforeAttention.length - 1);
  assert.equal(
    afterKPIs.recebidoNoMes,
    beforeKPIs.recebidoNoMes + target.amount
  );
  assert.equal(
    afterKPIs.totalAReceber,
    beforeKPIs.totalAReceber - target.amount
  );
  assert.ok(afterKPIs.taxaAdimplencia >= beforeKPIs.taxaAdimplencia);
});

test('rescheduleInstallment moves installment to new billing day in calendar', () => {
  const clients = createDemoClients(TODAY);
  const day15Before = groupInstallmentsByBillingDay(clients, 2026, 11, TODAY).find(
    (d) => d.dayOfMonth === 15
  );
  assert.ok(day15Before && day15Before.items.length > 0);

  const target = day15Before.items[0];
  const updated = rescheduleInstallment(clients, target.id, '2026-11-28');
  const daysAfter = groupInstallmentsByBillingDay(updated, 2026, 11, TODAY);

  const day28 = daysAfter.find((d) => d.dayOfMonth === 28);
  assert.ok(day28);
  assert.ok(day28.items.some((i) => i.id === target.id));

  const day15After = daysAfter.find((d) => d.dayOfMonth === 15);
  assert.equal(
    day15After?.items.length ?? 0,
    day15Before.items.length - 1
  );
});

test('filterClients filters by search, stage, and modality', () => {
  const clients = createDemoClients(TODAY);

  const byStage = filterClients(clients, {
    search: '',
    stage: '01- Etapa Luis',
    modality: 'Todas',
  });
  assert.ok(byStage.length > 0);
  assert.ok(byStage.every((c) => c.driveStage === '01- Etapa Luis'));

  const byModality = filterClients(clients, {
    search: '',
    stage: 'Todas',
    modality: 'Êxito 30%',
  });
  assert.ok(byModality.length > 0);
  assert.ok(byModality.every((c) => c.modality === 'Êxito 30%'));

  const byName = filterClients(clients, {
    search: clients[0].fullName.split(' ')[0],
    stage: 'Todas',
    modality: 'Todas',
  });
  assert.ok(byName.length >= 1);
});

test('calculateMonthlyChartData and calculateClientTotals produce consistent sums', () => {
  const clients = createDemoClients(TODAY);
  const chart = calculateMonthlyChartData(clients, 2026, 11);
  assert.equal(chart.length, 6);
  const novPoint = chart.find((p) => p.monthKey === '2026-11');
  assert.ok(novPoint && novPoint.previsto > 0 && novPoint.recebido > 0);

  const totals = calculateClientTotals(clients[0], TODAY);
  assert.equal(
    totals.saldoRestante,
    Math.max(0, totals.totalContratado - totals.totalPago)
  );
});

test('validateAppsScriptUrl enforces valid HTTPS Apps Script URLs', () => {
  assert.equal(validateAppsScriptUrl('').valid, false);
  assert.equal(validateAppsScriptUrl('http://script.google.com/macros/s/abc/exec').valid, false);
  assert.equal(validateAppsScriptUrl('https://example.com/webhook').valid, false);
  assert.equal(
    validateAppsScriptUrl('https://script.google.com/macros/s/AKfycbx123/exec').valid,
    true
  );
});

test('calculateDashboardKPIs uses exact cent arithmetic with undated balances, partial installments, and Pagamentos ledger', () => {
  const clients = [
    {
      id: 'BA-028',
      fullName: 'Ana Paula Campos Gurgel',
      phone: '61999990001',
      caseType: 'Alimentos',
      driveStage: 'Protocolados / Processo Ativo' as const,
      driveFolderUrl: 'https://drive.google.com/drive/folders/ana',
      modality: 'Parcelado' as const,
      contractedTotal: 2000,
      undatedBalance: 0,
      unlinkedCredit: 0,
      installments: [
        {
          id: 'BA-028-03',
          clientId: 'BA-028',
          clientName: 'Ana Paula Campos Gurgel',
          installmentNumber: 3,
          totalInstallments: 3,
          amount: 666.68,
          receivedAmount: 666.67,
          remainingAmount: 0.01,
          dueDate: '2026-11-10',
          lastPaymentDate: '2026-11-18',
        },
      ],
    },
    {
      id: 'BA-079',
      fullName: 'Francisco Vagner',
      phone: '61999990002',
      caseType: 'Divórcio',
      driveStage: '01- Etapa Luis' as const,
      driveFolderUrl: 'https://drive.google.com/drive/folders/vagner',
      modality: 'Parcelado' as const,
      contractedTotal: 3000,
      undatedBalance: 47750,
      unlinkedCredit: 500,
      installments: [
        {
          id: 'BA-079-DATED',
          clientId: 'BA-079',
          clientName: 'Francisco Vagner',
          installmentNumber: 1,
          totalInstallments: 1,
          amount: 130490.6,
          receivedAmount: 0,
          remainingAmount: 130490.6,
          dueDate: '2026-12-10',
        },
      ],
    },
  ];

  const payments = [
    {
      idPagamento: 'P1',
      valor: 6886.67,
      valorAtivo: 6886.67,
      dataPagamento: '2026-11-18',
      mesRecebido: '2026-11',
      statusRegistro: 'PAGO',
    },
    {
      idPagamento: 'P-JUROS',
      idCliente: 'JUROS',
      idParcela: 'BA-044-JUROS',
      valor: 20,
      valorAtivo: 20,
      dataPagamento: '2026-11-18',
      mesRecebido: '2026-11',
      statusRegistro: 'PAGO',
    },
    {
      idPagamento: 'P-OLD',
      valor: 13473.32,
      valorAtivo: 13473.32,
      dataPagamento: '',
      mesRecebido: '2026-10',
      statusRegistro: 'PAGO',
    },
  ];

  const kpis = calculateDashboardKPIs(clients, '2026-11-27', '2026-11', {
    payments,
  });

  // Exact cent parity with official Barreto spreadsheet Dashboard!
  assert.equal(kpis.saldoParcelasDatadas, 130490.61);
  assert.equal(kpis.saldoSemData, 47750);
  assert.equal(kpis.totalAReceber, 178240.61);
  assert.equal(kpis.creditoAVincular, 500);
  assert.equal(kpis.recebidoNoMes, 6906.67);
  assert.equal(kpis.totalJaRecebido, 20379.99);
  assert.equal(kpis.parcelasEmAtrasoValor, 0.01);
  assert.equal(kpis.parcelasEmAtrasoCount, 1);
  assert.equal(kpis.faltaNoMes, 0.01);

  const chart = calculateMonthlyChartData(clients, 2026, 11, payments);
  const novBar = chart.find((p) => p.monthKey === '2026-11');
  assert.equal(novBar?.recebido, 6906.67);
  const octBar = chart.find((p) => p.monthKey === '2026-10');
  assert.equal(octBar?.recebido, 13473.32);
});
