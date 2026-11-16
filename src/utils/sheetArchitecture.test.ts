import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDriveArchitecture,
  chooseBestClientsTab,
  detectHeaderRowIndex,
  formatArchitectureReport,
  inspectTabArchitecture,
  parseBRLAmount,
  parseFlexibleDateISO,
  parseSheetTabToClients,
} from './sheetArchitecture';

test('parseBRLAmount handles Brazilian and decimal numeric formats accurately', () => {
  assert.equal(parseBRLAmount('R$ 1.500,00'), 1500);
  assert.equal(parseBRLAmount('250,50'), 250.5);
  assert.equal(parseBRLAmount('1500.75'), 1500.75);
  assert.equal(parseBRLAmount('1.400'), 1400);
  assert.equal(parseBRLAmount(800), 800);
});

test('parseFlexibleDateISO handles BR dates, ISO dates, and Google Sheets serial numbers', () => {
  assert.equal(parseFlexibleDateISO('20/11/2026'), '2026-11-20');
  assert.equal(parseFlexibleDateISO('2026-11-20'), '2026-11-20');
  assert.equal(parseFlexibleDateISO('5/2/26'), '2026-02-05');
  // 46000 days after 1899-12-30
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(parseFlexibleDateISO(46000) ?? ''));
});

test('analyzeDriveArchitecture matches Clientes Tráfego Pago, stage folders, and client subfolders', () => {
  const driveSummary = analyzeDriveArchitecture([
    {
      id: 'root-1',
      name: 'Clientes Tráfego Pago',
      webViewLink: 'https://drive.google.com/drive/folders/root-1',
    },
    {
      id: 'stage-1',
      name: '01- Etapa Luis',
      parents: ['root-1'],
      webViewLink: 'https://drive.google.com/drive/folders/stage-1',
    },
    {
      id: 'stage-2',
      name: '03- Etapa Gilmar',
      parents: ['root-1'],
      webViewLink: 'https://drive.google.com/drive/folders/stage-2',
    },
    {
      id: 'client-a',
      name: 'Maria Aparecida Souza',
      parents: ['stage-1'],
      webViewLink: 'https://drive.google.com/drive/folders/client-a',
    },
    {
      id: 'client-b',
      name: 'Fernanda Oliveira Lima',
      parents: ['stage-2'],
      webViewLink: 'https://drive.google.com/drive/folders/client-b',
    },
    {
      id: 'client-c',
      name: 'Juliana Costa',
      parents: ['root-1'],
      webViewLink: 'https://drive.google.com/drive/folders/client-c',
    },
  ]);

  assert.equal(driveSummary.rootFolderId, 'root-1');
  assert.equal(driveSummary.rootFolderName, 'Clientes Tráfego Pago');
  assert.equal(driveSummary.stageFolders.length, 2);
  assert.equal(driveSummary.directClientFoldersCount, 1);
  assert.equal(driveSummary.totalClientFoldersCount, 3);
  assert.equal(
    driveSummary.clientStageByName['maria aparecida souza'],
    '01- Etapa Luis'
  );
  assert.equal(
    driveSummary.clientStageByName['fernanda oliveira lima'],
    '03- Etapa Gilmar'
  );
  assert.equal(
    driveSummary.clientFolderLinks['juliana costa'],
    'https://drive.google.com/drive/folders/client-c'
  );
});

test('detectHeaderRowIndex and chooseBestClientsTab skip title rows and pick the billing tab', () => {
  const summaryRows = [
    ['BARRETO ADVOCACIA — RESUMO MENSAL'],
    ['Mês', 'Total'],
    ['Novembro', 'R$ 10.000,00'],
  ];

  const billingRows = [
    ['BARRETO — HONORÁRIOS (ADS FAMÍLIA)'],
    ['Atualizado em Novembro/2026'],
    [
      'Cliente',
      'WhatsApp',
      'Ação',
      'Valor da Parcela',
      'Parcela',
      'Vencimento',
      'Status / Quitação',
    ],
    [
      'Maria Aparecida Souza',
      '11988887777',
      'Divórcio Consensual',
      'R$ 500,00',
      '1/6',
      '20/11/2026',
      'Em aberto',
    ],
    [
      'Maria Aparecida Souza',
      '11988887777',
      'Divórcio Consensual',
      'R$ 500,00',
      '2/6',
      '20/12/2026',
      'Pago',
    ],
    [
      'Fernanda Oliveira Lima',
      '11977776666',
      'Guarda e Alimentos',
      'R$ 400,00',
      '1/4',
      '15/11/2026',
      '15/11/2026',
    ],
    ['Total', '', '', 'R$ 1.400,00', '', '', ''],
  ];

  assert.equal(detectHeaderRowIndex(billingRows), 2);

  const tabResumo = inspectTabArchitecture('Resumo', 0, summaryRows);
  const tabHonorarios = inspectTabArchitecture('Honorários Família', 1, billingRows);

  assert.equal(tabHonorarios.headerRowNumber, 3);
  assert.equal(tabHonorarios.dataRowsCount, 4);
  assert.equal(tabHonorarios.recognizedColumns.clientName, 'Cliente');
  assert.equal(tabHonorarios.recognizedColumns.dueDate, 'Vencimento');

  const best = chooseBestClientsTab([tabResumo, tabHonorarios]);
  assert.equal(best?.title, 'Honorários Família');

  const driveSummary = analyzeDriveArchitecture([
    { id: 'root-1', name: 'Clientes Tráfego Pago' },
    { id: 'stage-2', name: '03- Etapa Gilmar', parents: ['root-1'] },
    {
      id: 'client-b',
      name: 'Fernanda Oliveira Lima',
      parents: ['stage-2'],
      webViewLink: 'https://drive.google.com/drive/folders/client-b',
    },
  ]);

  const clients = parseSheetTabToClients(billingRows, driveSummary, '2026-11-14');
  assert.equal(clients.length, 2);

  const maria = clients.find((c) => c.fullName === 'Maria Aparecida Souza');
  assert.ok(maria);
  assert.equal(maria.installments.length, 2);
  assert.equal(maria.contractedTotal, 1000);
  assert.equal(maria.installments[0].paidDate, undefined);
  assert.equal(maria.installments[1].paidDate, '2026-12-20');

  const fernanda = clients.find((c) => c.fullName === 'Fernanda Oliveira Lima');
  assert.ok(fernanda);
  assert.equal(fernanda.driveStage, '03- Etapa Gilmar');
  assert.equal(
    fernanda.driveFolderUrl,
    'https://drive.google.com/drive/folders/client-b'
  );
  assert.equal(fernanda.installments[0].paidDate, '2026-11-15');

  const report = formatArchitectureReport({
    inspectedAt: '2026-11-14T12:00:00Z',
    spreadsheetId: 'abc',
    spreadsheetTitle: 'Barreto — Honorários (Ads Família)',
    activeTabTitle: 'Honorários Família',
    tabs: [tabResumo, tabHonorarios],
    drive: driveSummary,
    parsedClientsCount: clients.length,
    parsedInstallmentsCount: 3,
  });
  assert.ok(report.includes('SOMENTE LEITURA'));
  assert.ok(report.includes('Honorários Família'));
  assert.ok(report.includes('Clientes Tráfego Pago'));
});
