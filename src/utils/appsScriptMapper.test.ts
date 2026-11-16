import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAppsScriptPayload } from './appsScriptMapper';

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
