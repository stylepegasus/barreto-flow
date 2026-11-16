import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocumentAnalysisPrompt,
  buildPortfolioContextSummary,
  findDocumentReferenceInQuery,
} from './assistantContext';
import { ClientCase } from '../types/honorarios';

const sampleClients: ClientCase[] = [
  {
    id: 'c1',
    fullName: 'Mariana Souza Almeida',
    phone: '11999990001',
    caseType: 'Divórcio Consensual',
    processNumber: '1002345-12.2026.8.26.0100',
    driveStage: '02- Etapa Carlos',
    driveFolderUrl: 'https://drive.google.com/drive/folders/1',
    driveFiles: [
      {
        id: 'f1',
        nome: 'Contrato de Honorários - Mariana.pdf',
        mimeType: 'application/pdf',
        url: 'https://drive.google.com/file/d/f1/view',
        atualizadoEm: '2026-11-01',
      },
      {
        id: 'f2',
        nome: 'Decisão Liminar Alimentos.pdf',
        mimeType: 'application/pdf',
        url: 'https://drive.google.com/file/d/f2/view',
        atualizadoEm: '2026-11-10',
      },
    ],
    modality: 'Parcelado',
    contractedTotal: 3000,
    installments: [
      {
        id: 'i1',
        clientId: 'c1',
        clientName: 'Mariana Souza Almeida',
        installmentNumber: 1,
        totalInstallments: 6,
        amount: 500,
        dueDate: '2026-11-10',
      },
      {
        id: 'i2',
        clientId: 'c1',
        clientName: 'Mariana Souza Almeida',
        installmentNumber: 2,
        totalInstallments: 6,
        amount: 500,
        dueDate: '2026-11-20',
      },
    ],
  },
  {
    id: 'c2',
    fullName: 'Fernanda Costa Ribeiro',
    phone: '11999990002',
    caseType: 'Guarda e Visitas',
    driveStage: 'Protocolados / Processo Ativo',
    driveFolderUrl: 'https://drive.google.com/drive/folders/2',
    driveFiles: [
      {
        id: 'f3',
        nome: 'Protocolo Inicial.pdf',
        mimeType: 'application/pdf',
        url: 'https://drive.google.com/file/d/f3/view',
      },
    ],
    modality: 'Êxito 30%',
    contractedTotal: 4500,
    installments: [],
  },
];

test('buildPortfolioContextSummary includes KPIs, goals, simulator, ZapSign audit, processNumber, Drive files, and calendar events', () => {
  const summary = buildPortfolioContextSummary(
    sampleClients,
    [
      {
        id: 'ev1',
        titulo: 'Cobrança Mariana',
        inicio: '2026-11-20T13:30:00-03:00',
        descricao: 'Parcela 2/6',
      },
    ],
    '2026-11-16',
    {
      goalsByMonth: { '2026-11': 30000 },
      defaultGoal: 25000,
      simulatorInputs: {
        monthlyAdsSpend: 4500,
        costPerLead: 40,
        conversionRatePct: 12,
        averageTicket: 2500,
        averageInstallments: 10,
        estimatedDefaultPct: 8,
      },
      simulatorOutputs: {
        estimatedLeads: 112.5,
        closedContractsPerMonth: 13.5,
        grossContractedRevenue: 33750,
        addedMonthlyRecurringRevenue: 3375,
        netCashAfterDefault: 31050,
        projectedRoiPct: 590,
        roiMultiple: 6.9,
      },
      zapSignDocs: [
        {
          token: 'zs-1',
          name: 'Contrato - Cliente Nova',
          signedAt: '2026-11-15T10:00:00Z',
          signers: [{ name: 'Patrícia Lima' }],
        },
      ],
      unmatchedZapSignDocs: [
        {
          token: 'zs-1',
          name: 'Contrato - Cliente Nova',
          signedAt: '2026-11-15T10:00:00Z',
          signers: [{ name: 'Patrícia Lima' }],
        },
      ],
    }
  );

  assert.match(summary, /Total de clientes na carteira: 2/);
  assert.match(summary, /Mariana Souza Almeida/);
  assert.match(summary, /1002345-12\.2026\.8\.26\.0100/);
  assert.match(summary, /Contrato de Honorários - Mariana\.pdf/);
  assert.match(summary, /Cobrança Mariana/);
  assert.match(summary, /Meta configurada para o mês atual/);
  assert.match(summary, /Investimento Ads/);
  assert.match(summary, /CONTRATOS ASSINADOS NO ZAPSIGN QUE NÃO CONSTAM NA PLANILHA/);
  assert.match(summary, /Patrícia Lima/);
});

test('findDocumentReferenceInQuery matches client and specific document type in natural language', () => {
  const matchDecision = findDocumentReferenceInQuery(
    'Analise a decisão da cliente Mariana Almeida',
    sampleClients
  );
  assert.ok(matchDecision);
  assert.equal(matchDecision.client.id, 'c1');
  assert.equal(matchDecision.file.id, 'f2');

  const matchProtocol = findDocumentReferenceInQuery(
    'Pode ler o protocolo da Fernanda Ribeiro?',
    sampleClients
  );
  assert.ok(matchProtocol);
  assert.equal(matchProtocol.client.id, 'c2');
  assert.equal(matchProtocol.file.id, 'f3');

  const noDocMatch = findDocumentReferenceInQuery(
    'Quem devemos cobrar hoje?',
    sampleClients
  );
  assert.equal(noDocMatch, null);
});

test('buildDocumentAnalysisPrompt asks for process number, object, dates, honorarios, rules, and updates', () => {
  const prompt = buildDocumentAnalysisPrompt(
    'Mariana Souza Almeida',
    'Contrato.pdf'
  );
  assert.match(prompt, /Mariana Souza Almeida/);
  assert.match(prompt, /Contrato\.pdf/);
  assert.match(prompt, /Número do processo/i);
  assert.match(prompt, /honorários/i);
  assert.match(prompt, /13h30/);
});
