import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapAppsScriptPayload,
  runPortfolioHealthCheck,
} from './appsScriptMapper';
import {
  isValidDriveFolderUrl,
  parseBRLAmountStrict,
  parseFlexibleDateStrict,
} from './sheetArchitecture';

test('mapAppsScriptPayload maps clientes, parcelas, driveEtapas, and eventosAgenda accurately', () => {
  const payload = {
    clientes: [
      {
        id: 'C001',
        nome: 'Mariana Souza Almeida',
        cpf: '123.456.789-00',
        totalContratado: 3000,
        totalPago: 1000,
        saldoRestante: 2000,
        primeiroVencimento: '2026-10-20',
        situacao: 'Em andamento',
        modalidade: 'Parcelado',
        parcelasRegulares: 6,
        entrada: 500,
        exitoPercentual: 0,
      },
      {
        id: 'C002',
        nome: 'Fernanda Costa Ribeiro',
        cpf: '987.654.321-11',
        totalContratado: 5000,
        totalPago: 0,
        saldoRestante: 5000,
        primeiroVencimento: '2026-12-15',
        situacao: 'Protocolado',
        modalidade: 'Êxito 30%',
        parcelasRegulares: 0,
        entrada: 0,
        exitoPercentual: 30,
      },
    ],
    parcelas: [
      {
        idParcela: 'P001-1',
        idCliente: 'C001',
        cliente: 'Mariana Souza Almeida',
        parcela: '1/6',
        vencimento: '2026-10-20T03:00:00.000Z',
        previsto: 500,
        recebido: 500,
        faltaReceber: 0,
        situacao: 'Paga',
        ultimoPagamento: '20/10/2026',
        alerta: '',
        dataConfirmada: '2026-10-20',
      },
      {
        idParcela: 'P001-2',
        idCliente: 'C001',
        cliente: 'Mariana Souza Almeida',
        parcela: '2/6',
        vencimento: '20/11/2026',
        previsto: 'R$ 500,00',
        recebido: 0,
        faltaReceber: 500,
        situacao: 'Em aberto',
        ultimoPagamento: '',
        alerta: 'Cobrar às 13h30',
        dataConfirmada: '',
      },
    ],
    driveEtapas: [
      {
        etapa: '02- Etapa Carlos',
        nomePasta: 'Mariana Souza Almeida - Divórcio',
        urlPasta: 'https://drive.google.com/drive/folders/folder-mariana',
        arquivos: [
          {
            id: 'file-mariana-contrato',
            nome: 'Contrato de Honorários - Mariana.pdf',
            mimeType: 'application/pdf',
            url: 'https://drive.google.com/file/d/file-mariana-contrato/view',
            atualizadoEm: '2026-10-18T14:20:00.000Z',
          },
        ],
      },
      {
        etapa: 'Protocolados / Processo Ativo',
        nomePasta: 'Fernanda Costa Ribeiro',
        urlPasta: 'https://drive.google.com/drive/folders/folder-fernanda',
        arquivos: [
          {
            id: 'file-fernanda-protocolo',
            nome: 'Comprovante de Protocolo.pdf',
            mimeType: 'application/pdf',
            url: 'https://drive.google.com/file/d/file-fernanda-protocolo/view',
            atualizadoEm: '2026-11-02T10:00:00.000Z',
          },
        ],
      },
    ],
    eventosAgenda: [
      {
        id: 'evt-1120',
        titulo: 'Cobrança Mariana Souza Almeida',
        inicio: '2026-11-20T13:30:00-03:00',
        fim: '2026-11-20T14:30:00-03:00',
        descricao: 'Parcela 2/6 - R$ 500,00',
      },
    ],
  };

  const result = mapAppsScriptPayload(payload, '2026-11-16');

  assert.equal(result.clients.length, 2);
  assert.equal(result.summary.clientesCount, 2);
  assert.equal(result.summary.parcelasCount, 2);
  assert.equal(result.summary.driveEtapasCount, 2);
  assert.equal(result.summary.matchedDriveCount, 2);
  assert.equal(result.summary.driveFilesCount, 2);
  assert.equal(result.summary.eventosAgendaCount, 1);

  const mariana = result.clients.find((c) => c.id === 'C001');
  assert.ok(mariana);
  assert.equal(mariana.driveStage, '02- Etapa Carlos');
  assert.equal(
    mariana.driveFolderUrl,
    'https://drive.google.com/drive/folders/folder-mariana'
  );
  assert.equal(mariana.driveFiles?.length, 1);
  assert.equal(mariana.driveFiles?.[0].id, 'file-mariana-contrato');
  assert.equal(
    mariana.driveFiles?.[0].nome,
    'Contrato de Honorários - Mariana.pdf'
  );
  assert.equal(mariana.modality, 'Parcelado');
  assert.equal(mariana.contractedTotal, 3000);
  assert.equal(mariana.installments.length, 2);
  assert.equal(mariana.installments[0].dueDate, '2026-10-20');
  assert.equal(mariana.installments[0].paidDate, '2026-10-20');
  assert.equal(mariana.installments[1].dueDate, '2026-11-20');
  assert.equal(mariana.installments[1].paidDate, undefined);
  assert.equal(mariana.installments[1].calendarEventId, 'evt-1120');

  const fernanda = result.clients.find((c) => c.id === 'C002');
  assert.ok(fernanda);
  assert.equal(fernanda.driveStage, 'Protocolados / Processo Ativo');
  assert.equal(fernanda.modality, 'Êxito 30%');
  assert.equal(fernanda.driveFiles?.length, 1);
  assert.equal(fernanda.driveFiles?.[0].id, 'file-fernanda-protocolo');
  assert.equal(
    fernanda.driveFolderUrl,
    'https://drive.google.com/drive/folders/folder-fernanda'
  );
});

test('mapAppsScriptPayload matches installments by client name and detects paid via recebido/faltaReceber', () => {
  const result = mapAppsScriptPayload(
    {
      clientes: [
        {
          id: '10',
          nome: 'Juliana Mendes Lima',
          totalContratado: 'R$ 1.200,00',
          modalidade: 'À vista',
        },
      ],
      parcelas: [
        {
          idParcela: 'p-10-1',
          cliente: 'Juliana Mendes Lima',
          parcela: 1,
          vencimento: '10/11/2026',
          previsto: '1.200,00',
          recebido: '1.200,00',
          faltaReceber: '0,00',
          situacao: 'Confirmado',
          dataConfirmada: '11/11/2026',
        },
      ],
      driveEtapas: [],
      eventosAgenda: [],
    },
    '2026-11-16'
  );

  assert.equal(result.clients.length, 1);
  assert.equal(result.clients[0].modality, 'À vista');
  assert.equal(result.clients[0].installments.length, 1);
  assert.equal(result.clients[0].installments[0].amount, 1200);
  assert.equal(result.clients[0].installments[0].paidDate, '2026-11-11');
});

test('mapAppsScriptPayload skips undated parcelas instead of dumping them onto todayISO', () => {
  const result = mapAppsScriptPayload(
    {
      clientes: [
        {
          id: '20',
          nome: 'Cliente Sem Data',
          totalContratado: 3000,
          modalidade: 'Êxito 30%',
        },
      ],
      parcelas: [
        {
          idParcela: 'p-20-1',
          idCliente: '20',
          cliente: 'Cliente Sem Data',
          parcela: '1/1',
          vencimento: '',
          previsto: 3000,
          situacao: 'Aguardando',
        },
      ],
      driveEtapas: [],
      eventosAgenda: [],
    },
    '2026-11-16'
  );

  assert.equal(result.clients.length, 1);
  assert.equal(result.clients[0].contractedTotal, 3000);
  assert.equal(result.clients[0].installments.length, 0);
});

test('mapAppsScriptPayload preserves raw driveEtapas including ZZ - Encerrados', () => {
  const result = mapAppsScriptPayload(
    {
      clientes: [],
      parcelas: [],
      driveEtapas: [
        {
          etapa: 'ZZ - Encerrados',
          nomePasta: 'Ex-Cliente Arquivado',
          urlPasta: 'https://drive.google.com/drive/folders/closed-1',
        },
      ],
      eventosAgenda: [],
    },
    '2026-11-16'
  );

  assert.equal(result.driveEtapas.length, 1);
  assert.equal(result.driveEtapas[0].etapa, 'ZZ - Encerrados');
  assert.equal(result.driveEtapas[0].nomePasta, 'Ex-Cliente Arquivado');
});

test('strict parsing validates BRL currency and real calendar dates while isolating corrupted rows without breaking portfolio totals', () => {
  const validCurrency = parseBRLAmountStrict('R$ 1.500,00');
  assert.equal(validCurrency.ok, true);
  assert.equal(validCurrency.value, 1500);

  const badCurrency = parseBRLAmountStrict('#VALUE!');
  assert.equal(badCurrency.ok, false);
  assert.equal(badCurrency.value, 0);

  const validDate = parseFlexibleDateStrict('20/11/2026');
  assert.equal(validDate.ok, true);
  assert.equal(validDate.iso, '2026-11-20');
  assert.ok(validDate.date instanceof Date);
  assert.equal(Number.isNaN(validDate.date.getTime()), false);

  // Impossible calendar date must fail strictly instead of rolling over silently
  const impossibleDate = parseFlexibleDateStrict('31/02/2026');
  assert.equal(impossibleDate.ok, false);
  assert.equal(impossibleDate.iso, undefined);
  assert.equal(impossibleDate.date, undefined);

  const result = mapAppsScriptPayload(
    {
      clientes: [
        {
          id: 'C-CORRUPT',
          nome: 'Lucas Pereira Santos',
          totalContratado: 'R$ 1.500,00',
          modalidade: 'Parcelado',
          parcelasRegulares: 3,
        },
        {
          id: 'C-CLEAN',
          nome: 'Ana Beatriz Lima',
          totalContratado: 'R$ 2.000,00',
          modalidade: 'À vista',
          parcelasRegulares: 1,
        },
      ],
      parcelas: [
        {
          idParcela: 'P-GOOD',
          idCliente: 'C-CORRUPT',
          cliente: 'Lucas Pereira Santos',
          parcela: '1/3',
          vencimento: '15/11/2026',
          previsto: 'R$ 500,00',
          recebido: 0,
          faltaReceber: 'R$ 500,00',
          situacao: 'Em aberto',
        },
        {
          idParcela: 'P-BAD-AMOUNT',
          idCliente: 'C-CORRUPT',
          cliente: 'Lucas Pereira Santos',
          parcela: '2/3',
          vencimento: '15/12/2026',
          previsto: '#VALUE!',
          recebido: 0,
          faltaReceber: '#REF!',
          situacao: 'Em aberto',
        },
        {
          idParcela: 'P-BAD-DATE',
          idCliente: 'C-CORRUPT',
          cliente: 'Lucas Pereira Santos',
          parcela: '3/3',
          vencimento: '31/02/2026',
          previsto: 'R$ 500,00',
          recebido: 0,
          faltaReceber: 'R$ 500,00',
          situacao: 'Em aberto',
        },
        {
          idParcela: 'P-CLEAN-1',
          idCliente: 'C-CLEAN',
          cliente: 'Ana Beatriz Lima',
          parcela: '1/1',
          vencimento: '20/11/2026',
          previsto: 'R$ 2.000,00',
          recebido: 'R$ 2.000,00',
          faltaReceber: '0,00',
          situacao: 'Paga',
          ultimoPagamento: '20/11/2026',
        },
      ],
      driveEtapas: [
        {
          etapa: '01- Etapa Luis',
          nomePasta: 'Ana Beatriz Lima',
          urlPasta: 'https://drive.google.com/drive/folders/ana-beatriz-01',
        },
      ],
      eventosAgenda: [],
    },
    '2026-11-16'
  );

  // Portfolio total remains exact & finite despite corrupted cells
  const totalContracted = result.clients.reduce(
    (sum, c) => sum + c.contractedTotal,
    0
  );
  assert.equal(totalContracted, 3500);
  assert.equal(Number.isFinite(totalContracted), true);

  const lucas = result.clients.find((c) => c.id === 'C-CORRUPT');
  assert.ok(lucas);
  // Only the 1 valid installment survives; the 2 corrupted rows are isolated
  assert.equal(lucas.installments.length, 1);
  assert.equal(lucas.installments[0].amount, 500);
  assert.ok(result.parseIssues.length >= 3);
  assert.ok(
    lucas.syncWarnings?.some((w) => w.code === 'CORRUPTED_SHEET_ROW')
  );
});

test('runPortfolioHealthCheck triangulates Sheets SSOT against Drive folder validity and Calendar active billing events', () => {
  assert.equal(
    isValidDriveFolderUrl('https://drive.google.com/drive/folders/abc12345'),
    true
  );
  assert.equal(
    isValidDriveFolderUrl('https://drive.google.com/drive/my-drive'),
    false
  );
  assert.equal(isValidDriveFolderUrl('javascript:alert(1)'), false);

  const result = mapAppsScriptPayload(
    {
      clientes: [
        {
          id: 'H1',
          nome: 'Mariana Souza Almeida',
          totalContratado: 1000,
          modalidade: 'Parcelado',
        },
        {
          id: 'H2',
          nome: 'Carlos Eduardo Rocha',
          totalContratado: 1200,
          modalidade: 'Parcelado',
        },
      ],
      parcelas: [
        {
          idParcela: 'HP1',
          idCliente: 'H1',
          cliente: 'Mariana Souza Almeida',
          parcela: '1/1',
          vencimento: '20/11/2026',
          previsto: 1000,
          recebido: 0,
          faltaReceber: 1000,
          situacao: 'Em aberto',
        },
        {
          idParcela: 'HP2',
          idCliente: 'H2',
          cliente: 'Carlos Eduardo Rocha',
          parcela: '1/1',
          vencimento: '25/11/2026',
          previsto: 1200,
          recebido: 0,
          faltaReceber: 1200,
          situacao: 'Em aberto',
        },
      ],
      driveEtapas: [
        {
          etapa: '02- Etapa Carlos',
          nomePasta: 'BA-010 - Mariana Souza Almeida',
          urlPasta: 'https://drive.google.com/drive/folders/mariana-ok-123',
        },
      ],
      eventosAgenda: [
        {
          id: 'cal-h1',
          titulo: 'Cobrança Honorários — Mariana Souza Almeida',
          inicio: '2026-11-20T13:30:00-03:00',
          descricao: 'Parcela 1/1',
        },
      ],
    },
    '2026-11-16'
  );

  // H1 has valid Drive folder + matching Calendar event -> healthy
  const mariana = result.clients.find((c) => c.id === 'H1');
  assert.equal(mariana?.healthCheck?.healthy, true);
  assert.equal(mariana?.healthCheck?.driveOk, true);
  assert.equal(mariana?.healthCheck?.calendarOk, true);
  assert.equal(mariana?.syncWarnings?.length, 0);

  // H2 has NO Drive folder and NO Calendar event for pending installment -> non-blocking warnings surfaced
  const carlos = result.clients.find((c) => c.id === 'H2');
  assert.equal(carlos?.healthCheck?.healthy, false);
  assert.equal(carlos?.healthCheck?.driveOk, false);
  assert.equal(carlos?.healthCheck?.calendarOk, false);
  assert.ok(carlos?.syncWarnings?.some((w) => w.code === 'MISSING_DRIVE_FOLDER'));
  assert.ok(carlos?.syncWarnings?.some((w) => w.code === 'MISSING_CALENDAR_EVENT'));

  assert.equal(result.healthReport.totalClients, 2);
  assert.equal(result.healthReport.healthyClientsCount, 1);
  assert.equal(result.healthReport.clientsWithWarningsCount, 1);
  assert.equal(result.healthReport.missingDriveCount, 1);
  assert.equal(result.healthReport.missingCalendarEventsCount, 1);

  // Also verify direct runPortfolioHealthCheck flags malformed Drive URLs
  const brokenUrlReport = runPortfolioHealthCheck(
    [
      {
        ...carlos!,
        driveFolderUrl: 'https://example.com/not-drive',
      },
    ],
    [],
    []
  );
  assert.ok(
    brokenUrlReport.warningsByClientId['H2'].some(
      (w) => w.code === 'INVALID_DRIVE_URL'
    )
  );
});

test('mapAppsScriptPayload handles boolean dataConfirmada with zero parseIssues, partial installments, undated balance, unlinked credit, and Pagamentos ledger', () => {
  const result = mapAppsScriptPayload(
    {
      clientes: [
        {
          id: 'BA-028',
          nome: 'Ana Paula Campos Gurgel',
          totalContratado: 666.68,
          totalPago: 666.67,
          saldoRestante: 0.01,
          situacao: 'EM ATRASO',
          modalidade: 'Parcelado',
          parcelasRegulares: 3,
        },
        {
          id: 'BA-079',
          nome: 'Francisco Vagner',
          totalContratado: 3000,
          totalPago: 500,
          saldoRestante: 2500,
          situacao: 'SEM VENCIMENTO',
          modalidade: 'Parcelado',
          parcelasRegulares: 10,
        },
        {
          id: 'BA-090',
          nome: 'Cliente Sem Data Confirmada',
          totalContratado: 2000,
          totalPago: 0,
          saldoRestante: 2000,
          situacao: 'AGUARDANDO',
          modalidade: 'Parcelado',
          parcelasRegulares: 4,
        },
      ],
      parcelas: [
        {
          idParcela: 'BA-028-03',
          idCliente: 'BA-028',
          cliente: 'Ana Paula Campos Gurgel',
          parcela: '3/3',
          vencimento: '2026-11-10',
          previsto: 666.68,
          recebido: 666.67,
          faltaReceber: 0.01,
          situacao: 'PARCIAL',
          ultimoPagamento: '2026-11-18',
          dataConfirmada: true,
        },
        {
          idParcela: 'BA-079-01',
          idCliente: 'BA-079',
          cliente: 'Francisco Vagner',
          parcela: '1/10',
          vencimento: '',
          previsto: 3000,
          recebido: 0,
          faltaReceber: 3000,
          situacao: 'DEFINIR VENCIMENTO',
          ultimoPagamento: '',
          dataConfirmada: false,
        },
        {
          idParcela: 'BA-090-01',
          idCliente: 'BA-090',
          cliente: 'Cliente Sem Data Confirmada',
          parcela: '1/4',
          vencimento: 'A definir',
          previsto: 'R$ 2.000,00',
          recebido: 'R$ 0,00',
          faltaReceber: 'R$ 2.000,00',
          situacao: 'SEM DATA',
          dataConfirmada: false,
        },
      ],
      pagamentos: [
        {
          idPagamento: 'PAG-1',
          cliente: 'Ana Paula Campos Gurgel',
          idCliente: 'BA-028',
          idParcela: 'BA-028-03',
          valor: 666.67,
          valorAtivo: 666.67,
          dataPagamento: '2026-11-18',
          mesRecebido: '2026-11-01',
          statusRegistro: 'PAGO',
        },
        {
          idPagamento: 'PAG-JUROS',
          cliente: 'Mayara Lima Gomes',
          idCliente: 'JUROS',
          idParcela: 'BA-044-JUROS',
          valor: 20,
          valorAtivo: 20,
          dataPagamento: '2026-11-18',
          mesRecebido: '2026-11-01',
          statusRegistro: 'PAGO',
        },
        {
          idPagamento: 'HIST-CRED-BA-079',
          cliente: 'Francisco Vagner',
          idCliente: 'BA-079',
          idParcela: '',
          valor: 500,
          valorAtivo: 500,
          dataPagamento: '',
          mesRecebido: '2026-09-01',
          statusRegistro: 'PAGO',
        },
        {
          idPagamento: 'PAG-ESTORNADO',
          cliente: 'Estorno Teste',
          idCliente: 'BA-028',
          valor: 300,
          valorAtivo: 0,
          dataPagamento: '2026-11-19',
          mesRecebido: '2026-11-01',
          statusRegistro: 'PENDENTE',
        },
      ],
      driveEtapas: [],
      eventosAgenda: [],
    },
    '2026-11-27'
  );

  // Zero false parse issues from booleans (dataConfirmada) or empty/placeholder cells
  assert.equal(result.parseIssues.length, 0);

  // Partial installment with R$ 0,01 remaining MUST NOT be marked paid
  const ana = result.clients.find((c) => c.id === 'BA-028');
  assert.ok(ana);
  assert.equal(ana.installments.length, 1);
  assert.equal(ana.installments[0].paidDate, undefined);
  assert.equal(ana.installments[0].receivedAmount, 666.67);
  assert.equal(ana.installments[0].remainingAmount, 0.01);
  assert.equal(ana.installments[0].lastPaymentDate, '2026-11-18');

  // Unlinked credit and net undated balance reconciled to the exact cent
  const vagner = result.clients.find((c) => c.id === 'BA-079');
  assert.ok(vagner);
  assert.equal(vagner.unlinkedCredit, 500);
  assert.equal(vagner.undatedBalance, 2500);

  // Official dashboard consolidation matches spreadsheet formulas
  assert.equal(result.officialDashboard?.saldoParcelasDatadas, 0.01);
  assert.equal(result.officialDashboard?.saldoSemData, 4500);
  assert.equal(result.officialDashboard?.saldoTotalAReceber, 4500.01);
  assert.equal(result.officialDashboard?.creditoAVincular, 500);
  assert.equal(result.officialDashboard?.recebidoNoMes, 686.67);
  assert.equal(result.officialDashboard?.totalJaRecebido, 1186.67);
  assert.equal(result.officialDashboard?.parcelasAtrasadasValor, 0.01);
  assert.equal(result.payments?.length, 3);
});
