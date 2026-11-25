import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_FIRM_NAME,
  ASSISTANT_NAME,
  ASSISTANT_ROLE_LABEL,
  MAX_PORTFOLIO_CONTEXT_CHARS,
  buildDocumentAnalysisPrompt,
  buildDonaSystemPrompt,
  buildPortfolioContextSummary,
  findDocumentReferenceInQuery,
  sanitizeContextText,
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

test('buildDonaSystemPrompt defines Dona exclusively as executive financial and operational assistant for Barreto Advocacia', () => {
  assert.equal(ASSISTANT_NAME, 'Dona');
  assert.equal(ASSISTANT_FIRM_NAME, 'Barreto Advocacia');
  assert.equal(ASSISTANT_ROLE_LABEL, 'Assistente Financeira e Operacional');

  const promptWithContext = buildDonaSystemPrompt(
    'Total de clientes na carteira: 2'
  );
  assert.match(promptWithContext, /Você é Dona/);
  assert.match(promptWithContext, /assistente financeira e operacional/i);
  assert.match(promptWithContext, /Barreto Advocacia/);
  assert.match(promptWithContext, /DIRETO E EXECUTIVO/);
  assert.match(promptWithContext, /FIDELIDADE ABSOLUTA AOS DADOS/);
  assert.match(promptWithContext, /MODO SOMENTE LEITURA/);
  assert.match(promptWithContext, /barretoadvocacia01@gmail\.com/);
  assert.match(promptWithContext, /Total de clientes na carteira: 2/);

  const promptWithoutContext = buildDonaSystemPrompt('   ');
  assert.match(promptWithoutContext, /Você é Dona/);
  assert.match(
    promptWithoutContext,
    /Nenhum dado adicional da carteira foi enviado nesta chamada\./
  );
});

test('buildPortfolioContextSummary includes Dona identity, session state, KPIs, goals, simulator, ZapSign audit, Drive files, and calendar events', () => {
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
      activeTab: 'clientes',
      selectedMonthKey: '2026-11',
      sourceMode: 'apps_script',
      readOnlyMode: true,
      activeFilters: {
        search: 'Mariana',
        stage: '02- Etapa Carlos',
        modality: 'Parcelado',
      },
      focusedClientName: 'Mariana Souza Almeida',
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

  assert.match(
    summary,
    /ASSISTENTE: Dona \(Assistente Financeira e Operacional — Barreto Advocacia \/ Barreto Flow\)/
  );
  assert.match(summary, /Visão atual no painel: Clientes & Processos/);
  assert.match(summary, /Origem dos dados: Planilha Real \(Somente Leitura\)/);
  assert.match(summary, /Filtros ativos na tela: Busca: "Mariana"/);
  assert.match(summary, /Cliente em foco na tela: Mariana Souza Almeida/);
  assert.match(summary, /Total de clientes na carteira: 2 \| Parcelas em aberto: 2/);
  assert.match(summary, /Mariana Souza Almeida/);
  assert.match(summary, /1002345-12\.2026\.8\.26\.0100/);
  assert.match(summary, /Contrato de Honorários - Mariana\.pdf/);
  assert.match(summary, /Cobrança Mariana/);
  assert.match(summary, /Meta configurada para o mês atual/);
  assert.match(summary, /Investimento Ads/);
  assert.match(summary, /CONTRATOS ASSINADOS NO ZAPSIGN QUE NÃO CONSTAM NA PLANILHA/);
  assert.match(summary, /Patrícia Lima/);
  assert.doesNotMatch(summary, /\[Token: zs-1\]/);
});

test('buildPortfolioContextSummary includes focused installment details when a billing item is active', () => {
  const summary = buildPortfolioContextSummary(sampleClients, [], '2026-11-16', {
    activeTab: 'calendario',
    focusedInstallment: {
      clientName: 'Mariana Souza Almeida',
      installmentNumber: 1,
      totalInstallments: 6,
      amount: 500,
      dueDate: '2026-11-10',
      status: 'Atrasada',
    },
  });

  assert.match(summary, /Visão atual no painel: Calendário de Cobranças/);
  assert.match(
    summary,
    /Cobrança em foco na tela: Mariana Souza Almeida \| Parcela 1\/6/
  );
});

test('sanitizeContextText redacts credential-like tokens and buildPortfolioContextSummary stays within budget', () => {
  const redacted = sanitizeContextText(
    'Nota com chave AIzaSyDummyKeyValue123456789012345 e Bearer supersecrettoken123456'
  );
  assert.doesNotMatch(redacted, /AIzaSyDummyKeyValue/);
  assert.doesNotMatch(redacted, /supersecrettoken/);
  assert.match(redacted, /\[credencial ocultada\]/);

  const hugeClients: ClientCase[] = Array.from({ length: 450 }, (_, idx) => ({
    id: `bulk-${idx}`,
    fullName: `Cliente Carteira Extensa ${idx + 1} Sobrenome Completo`,
    phone: '11999990000',
    caseType: 'Ação de Divórcio e Partilha de Bens com Alimentos',
    processNumber: `100000${idx}-12.2026.8.26.0100`,
    driveStage: 'Protocolados / Processo Ativo',
    driveFolderUrl: '',
    modality: 'Parcelado',
    contractedTotal: 5000,
    notes: 'Observação operacional detalhada da cliente com histórico completo.',
    installments: [],
  }));

  const bounded = buildPortfolioContextSummary(hugeClients, [], '2026-11-16');
  assert.ok(bounded.length <= MAX_PORTFOLIO_CONTEXT_CHARS);
  assert.match(bounded, /Resumo condensado/);
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

test('buildDocumentAnalysisPrompt addresses Dona and asks for process number, object, dates, honorarios, rules, and updates', () => {
  const prompt = buildDocumentAnalysisPrompt(
    'Mariana Souza Almeida',
    'Contrato.pdf'
  );
  assert.match(prompt, /^Dona,/);
  assert.match(prompt, /Mariana Souza Almeida/);
  assert.match(prompt, /Contrato\.pdf/);
  assert.match(prompt, /Número do processo/i);
  assert.match(prompt, /honorários/i);
  assert.match(prompt, /13h30/);
});
