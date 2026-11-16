import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatZapSignDateBR,
  isNameMatch,
  matchZapSignToClients,
  normalizeZapSignDocsPayload,
} from './zapsignLogic';
import { AppsScriptDriveEtapaRow, ClientCase } from '../types/honorarios';

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
    fullName: 'Kennúbia Silva Pereira',
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

test('isNameMatch ignores Portuguese prepositions and handles accent/phonetic variations (Kennúbia vs Kennúbya)', () => {
  assert.equal(
    isNameMatch('Kennúbia Silva Pereira', 'Kennubya da Silva Pereira'),
    true
  );
  assert.equal(
    isNameMatch('Maria das Graças de Oliveira', 'Maria Gracas Oliveira'),
    true
  );
  assert.equal(
    isNameMatch('Thiago de Souza', 'Tiago Souza'),
    true
  );
  assert.equal(
    isNameMatch('Beatriz Nogueira', 'Camila Ferreira'),
    false
  );
});

test('matchZapSignToClients performs 3-way cross-referencing (ZapSign x Planilha x Drive) and excludes ZZ - Encerrados', () => {
  const driveEtapas: AppsScriptDriveEtapaRow[] = [
    {
      etapa: '02- Etapa Carlos',
      nomePasta: 'Beatriz Nogueira - Divórcio',
      urlPasta: 'https://drive.google.com/drive/folders/beatriz-folder',
    },
    {
      etapa: 'ZZ - Encerrados',
      nomePasta: 'Lucas Andrade Mendonça',
      urlPasta: 'https://drive.google.com/drive/folders/lucas-encerrado',
    },
  ];

  const signedDocs = normalizeZapSignDocsPayload([
    {
      // Generic doc name, matched via signers[0].name phonetic + preposition variation
      token: 'zs-matched-phonetic',
      name: 'Contrato de Honorários Advocatícios.pdf',
      status: 'signed',
      created_at: '2026-11-10T10:00:00Z',
      signers: [
        { name: 'Kennúbya da Silva Pereira', signed_at: '2026-11-11T12:00:00Z' },
        { name: 'Barreto Advocacia', signed_at: '2026-11-11T12:05:00Z' },
      ],
    },
    {
      // Missing from spreadsheet, exists in active Drive folder
      token: 'zs-missing-with-drive',
      name: 'Contrato Padrão.pdf',
      status: 'signed',
      created_at: '2026-11-13T09:00:00Z',
      signed_file: 'https://app.zapsign.com.br/signed/beatriz.pdf',
      signers: [{ name: 'Beatriz Nogueira', signed_at: '2026-11-14T18:20:00Z' }],
    },
    {
      // Missing from spreadsheet, but inside ZZ - Encerrados -> MUST be excluded from unmatched alert!
      token: 'zs-closed-drive',
      name: 'Contrato Honorários.pdf',
      status: 'signed',
      created_at: '2026-10-05T09:00:00Z',
      signers: [{ name: 'Lucas de Andrade Mendonca', signed_at: '2026-10-06T11:00:00Z' }],
    },
    {
      // Missing from both spreadsheet and Drive
      token: 'zs-missing-no-drive',
      name: 'Procuração + Contrato.pdf',
      status: 'signed',
      created_at: '2026-11-15T10:00:00Z',
      signers: [{ name: 'Fernanda Costa Alves', signed_at: '2026-11-15T11:30:00Z' }],
    },
  ]);

  const result = matchZapSignToClients(mockClients, signedDocs, driveEtapas);

  // Phonetic + preposition match attached to Kennúbia (c2)
  assert.equal(result.matchedByClientId['c2']?.length, 1);
  assert.equal(result.matchedByClientId['c2']?.[0].token, 'zs-matched-phonetic');

  // ZZ - Encerrados excluded from unmatchedDocs & classified as closed_archive
  assert.equal(result.closedAuditItems.length, 1);
  assert.equal(result.closedAuditItems[0].doc.token, 'zs-closed-drive');
  assert.equal(result.closedAuditItems[0].auditStatus, 'closed_archive');

  // Only the 2 truly missing non-closed contracts remain in unmatchedAuditItems
  assert.equal(result.unmatchedDocs.length, 2);
  assert.equal(result.unmatchedAuditItems.length, 2);

  // Sorted newest signedAt first -> Fernanda (Nov 15) then Beatriz (Nov 14)
  assert.equal(result.unmatchedAuditItems[0].primarySignerName, 'Fernanda Costa Alves');
  assert.equal(result.unmatchedAuditItems[0].driveFolder, undefined);

  assert.equal(result.unmatchedAuditItems[1].primarySignerName, 'Beatriz Nogueira');
  assert.equal(result.unmatchedAuditItems[1].driveFolder?.etapa, '02- Etapa Carlos');
  assert.equal(
    result.unmatchedAuditItems[1].driveFolder?.urlPasta,
    'https://drive.google.com/drive/folders/beatriz-folder'
  );
});

test('formatZapSignDateBR converts ISO timestamps into dd/mm/yyyy', () => {
  assert.equal(formatZapSignDateBR('2026-11-14T18:20:00Z'), '14/11/2026');
  assert.equal(formatZapSignDateBR('2026-11-05'), '05/11/2026');
  assert.equal(formatZapSignDateBR(''), '');
});
