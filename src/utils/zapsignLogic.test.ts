import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatZapSignDateBR,
  matchZapSignToClients,
  normalizeZapSignDocsPayload,
} from './zapsignLogic';
import { ClientCase } from '../types/honorarios';

const mockClients: ClientCase[] = [
  {
    id: 'c1',
    fullName: 'Mariana Souza Almeida',
    phone: '11999990001',
    caseType: 'Divórcio Consensual',
    driveStage: '02- Etapa Carlos',
    driveFolderUrl: 'https://drive.google.com/drive/folders/1',
    modality: 'Parcelado',
    contractedTotal: 3000,
    installments: [],
  },
  {
    id: 'c2',
    fullName: 'Camila Ferreira Santos',
    phone: '11999990002',
    caseType: 'Pensão Alimentícia',
    driveStage: '01- Etapa Luis',
    driveFolderUrl: 'https://drive.google.com/drive/folders/2',
    modality: 'À vista',
    contractedTotal: 2000,
    installments: [],
  },
];

test('normalizeZapSignDocsPayload strictly keeps only status === signed and ignores pending/canceled', () => {
  const rawDocs = [
    {
      token: 'doc-signed-1',
      name: 'Contrato Honorários - Mariana Almeida',
      status: 'signed',
      created_at: '2026-11-10T10:00:00Z',
      last_update_at: '2026-11-11T15:30:00Z',
      signed_file: 'https://app.zapsign.com.br/signed/doc-signed-1.pdf',
      signers: [
        {
          name: 'Mariana Souza Almeida',
          email: 'mariana@example.com',
          phone_country: '55',
          phone_number: '11999990001',
          signed_at: '2026-11-11T15:30:00Z',
        },
      ],
    },
    {
      token: 'doc-pending-1',
      name: 'Contrato Honorários - João Pendente',
      status: 'pending',
      created_at: '2026-11-12T10:00:00Z',
      signers: [{ name: 'João Pendente' }],
    },
    {
      token: 'doc-canceled-1',
      name: 'Contrato Cancelado',
      status: 'canceled',
      created_at: '2026-11-09T10:00:00Z',
      signers: [{ name: 'Maria Cancelada' }],
    },
  ];

  const normalized = normalizeZapSignDocsPayload(rawDocs);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].token, 'doc-signed-1');
  assert.equal(normalized[0].status, 'signed');
  assert.equal(normalized[0].signers[0].phone, '+55 11999990001');
});

test('matchZapSignToClients separates matched clients from unmatched signed ZapSign contracts', () => {
  const signedDocs = normalizeZapSignDocsPayload([
    {
      token: 'zs-matched',
      name: 'Honorários Advocatícios - Mariana',
      status: 'signed',
      created_at: '2026-11-10T10:00:00Z',
      signers: [{ name: 'Mariana Souza Almeida', signed_at: '2026-11-11T12:00:00Z' }],
    },
    {
      token: 'zs-unmatched',
      name: 'Contrato Família - Beatriz Nogueira',
      status: 'signed',
      created_at: '2026-11-13T09:00:00Z',
      signers: [{ name: 'Beatriz Nogueira', signed_at: '2026-11-14T18:20:00Z' }],
    },
  ]);

  const { matchedByClientId, unmatchedDocs } = matchZapSignToClients(
    mockClients,
    signedDocs
  );

  assert.equal(matchedByClientId['c1']?.length, 1);
  assert.equal(matchedByClientId['c1']?.[0].token, 'zs-matched');
  assert.equal(matchedByClientId['c2'], undefined);
  assert.equal(unmatchedDocs.length, 1);
  assert.equal(unmatchedDocs[0].token, 'zs-unmatched');
});

test('formatZapSignDateBR converts ISO timestamps into dd/mm/yyyy', () => {
  assert.equal(formatZapSignDateBR('2026-11-14T18:20:00Z'), '14/11/2026');
  assert.equal(formatZapSignDateBR('2026-11-05'), '05/11/2026');
  assert.equal(formatZapSignDateBR(''), '');
});
