import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkExcludedZapSignFolder,
  cleanZapSignDocumentTitle,
  diagnoseZapSignDocument,
  extractIndividualNamesFromTitle,
  formatZapSignDateBR,
  isExcludedZapSignFolder,
  isFirmSignerName,
  isNameMatch,
  isProceduralDocumentTitle,
  matchZapSignToClients,
  normalizeRobustString,
  normalizeZapSignDocsPayload,
  normalizeZapSignTitle,
  stripDriveFolderDecorators,
} from './zapsignLogic';
import {
  AppsScriptCalendarEventRow,
  AppsScriptDriveEtapaRow,
  ClientCase,
} from '../types/honorarios';

const mockClients: ClientCase[] = [
  {
    id: 'c1',
    fullName: 'Mariana Souza Almeida',
    cpf: '123.456.789-01',
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
  {
    id: 'c3',
    fullName: 'Rainara Oliveira Mendes',
    phone: '61988887777',
    caseType: 'Inventário · CPF 987.654.321-00',
    driveStage: '03- Etapa Gilmar',
    driveFolderUrl: 'https://drive.google.com/drive/folders/3',
    modality: 'Parcelado',
    contractedTotal: 4500,
    installments: [],
  },
];

test('normalizeZapSignDocsPayload strictly keeps only status === signed and preserves folder_path and signer CPF', () => {
  const rawDocs = [
    {
      token: 'doc-signed-1',
      name: 'Contrato Honorários - Mariana Almeida',
      status: 'signed',
      folder_path: '/Clientes Ativos/Divórcio',
      created_at: '2026-11-10T10:00:00Z',
      last_update_at: '2026-11-11T15:30:00Z',
      signed_file: 'https://app.zapsign.com.br/signed/doc-signed-1.pdf',
      signers: [
        {
          name: 'Mariana Souza Almeida',
          email: 'mariana@example.com',
          phone_country: '55',
          phone_number: '11999990001',
          cpf: '12345678901',
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
  assert.equal(normalized[0].folderPath, '/Clientes Ativos/Divórcio');
  assert.equal(normalized[0].folderName, 'Divórcio');
  assert.equal(normalized[0].signers[0].phone, '+55 11999990001');
  assert.equal(normalized[0].signers[0].cpf, '123.456.789-01');
});

test('isExcludedZapSignFolder ignores ZZ - Encerrados, Docs Faltavam, and Fechados do Escritório (case/accent/trim insensitive)', () => {
  assert.equal(isExcludedZapSignFolder('/ZZ - Encerrados', undefined), true);
  assert.equal(isExcludedZapSignFolder('  /clientes/docs faltavam  ', undefined), true);
  assert.equal(
    isExcludedZapSignFolder('/Fechados do Escritorio', undefined),
    true
  );
  assert.equal(
    isExcludedZapSignFolder(undefined, '  FECHADOS DO ESCRITÓRIO '),
    true
  );
  assert.equal(isExcludedZapSignFolder('/02- Etapa Carlos', '02- Etapa Carlos'), false);
});

test('cleanZapSignDocumentTitle and extractIndividualNamesFromTitle strip legal prefixes, extensions, and split co-holders', () => {
  const rawMulti =
    ', Procuração e Declarações Rainara, Rayla e Luiz Felipe.docx';
  assert.equal(
    cleanZapSignDocumentTitle(rawMulti),
    'Rainara, Rayla e Luiz Felipe'
  );
  assert.deepEqual(extractIndividualNamesFromTitle(rawMulti), [
    'Rainara',
    'Rayla',
    'Luiz Felipe',
  ]);

  const rawProcedural =
    'PROCESSO 0726687-33.2026.8.07.0020 - INTERDIÇÃO_CURATELA - Assinatura.pdf';
  assert.equal(isProceduralDocumentTitle(rawProcedural), true);
  assert.equal(cleanZapSignDocumentTitle(rawProcedural), '');

  const rawCompound =
    'Contrato, Procuração e Declarações - Camila Duarte Ferreira - Assinatura.pdf';
  assert.equal(
    cleanZapSignDocumentTitle(rawCompound),
    'Camila Duarte Ferreira'
  );
  assert.deepEqual(extractIndividualNamesFromTitle(rawCompound), [
    'Camila Duarte Ferreira',
  ]);
});

test('stripDriveFolderDecorators cleans case prefixes and area suffixes and isFirmSignerName excludes internal firm signers', () => {
  assert.equal(
    stripDriveFolderDecorators('BA-048 - Beatriz Nogueira - Divórcio'),
    'Beatriz Nogueira'
  );
  assert.equal(
    stripDriveFolderDecorators('012. João Pedro Santos (Guarda)'),
    'João Pedro Santos'
  );
  assert.equal(isFirmSignerName('Paulo Barreto'), true);
  assert.equal(isFirmSignerName('Barreto Advocacia'), true);
  assert.equal(
    isFirmSignerName('Equipe Jurídica', 'barretoadvocacia01@gmail.com'),
    true
  );
  assert.equal(isFirmSignerName('Beatriz Nogueira'), false);
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
  assert.equal(isNameMatch('Thiago de Souza', 'Tiago Souza'), true);
  assert.equal(isNameMatch('Beatriz Nogueira', 'Camila Ferreira'), false);
});

test('matchZapSignToClients excludes Docs Faltavam, Fechados do Escritório, ZZ - Encerrados, and separates PROCESSO non-contract files', () => {
  const driveEtapas: AppsScriptDriveEtapaRow[] = [
    {
      etapa: 'ZZ - Encerrados',
      nomePasta: 'Lucas Andrade Mendonça',
      urlPasta: 'https://drive.google.com/drive/folders/lucas-encerrado',
    },
  ];

  const signedDocs = normalizeZapSignDocsPayload([
    {
      token: 'zs-docs-faltavam',
      name: 'Contrato - Cliente Docs Faltavam.pdf',
      status: 'signed',
      folder_path: '/Docs Faltavam',
      created_at: '2026-11-10T10:00:00Z',
      signers: [{ name: 'Carla Antunes', signed_at: '2026-11-10T12:00:00Z' }],
    },
    {
      token: 'zs-fechados-escritorio',
      name: 'Contrato - Cliente Fechado Escritorio.pdf',
      status: 'signed',
      folder: { name: 'Fechados do Escritório' },
      created_at: '2026-11-11T10:00:00Z',
      signers: [{ name: 'Rafael Prado', signed_at: '2026-11-11T12:00:00Z' }],
    },
    {
      token: 'zs-zz-encerrados-zapsign',
      name: 'Contrato - Encerrado ZapSign.pdf',
      status: 'signed',
      folder_path: '/ZZ - Encerrados',
      created_at: '2026-11-08T10:00:00Z',
      signers: [{ name: 'Débora Cunha', signed_at: '2026-11-08T12:00:00Z' }],
    },
    {
      token: 'zs-zz-encerrados-drive',
      name: 'Contrato Honorários.pdf',
      status: 'signed',
      created_at: '2026-10-05T09:00:00Z',
      signers: [
        { name: 'Lucas de Andrade Mendonca', signed_at: '2026-10-06T11:00:00Z' },
      ],
    },
    {
      token: 'zs-procedural-doc',
      name: 'PROCESSO 0726687-33.2026.8.07.0020 - INTERDIÇÃO_CURATELA - Assinatura.pdf',
      status: 'signed',
      created_at: '2026-11-14T09:00:00Z',
      signers: [{ name: 'Paulo Barreto', signed_at: '2026-11-14T10:00:00Z' }],
    },
  ]);

  const result = matchZapSignToClients(mockClients, signedDocs, driveEtapas, []);

  assert.equal(result.unmatchedAuditItems.length, 0);
  assert.equal(result.unmatchedDocs.length, 0);
  assert.equal(result.excludedFolderItems.length, 4);
  assert.equal(result.closedAuditItems.length, 2);
  assert.equal(result.proceduralAuditItems.length, 1);
  assert.equal(result.proceduralAuditItems[0].doc.token, 'zs-procedural-doc');
  assert.equal(
    result.proceduralAuditItems[0].auditStatus,
    'procedural_non_contract'
  );
});

test('matchZapSignToClients reconciles multi-source across Sheets (CPF/phone/co-holder), Drive (BA-048 prefix), and Calendar with full diagnostics', () => {
  const driveEtapas: AppsScriptDriveEtapaRow[] = [
    {
      etapa: '02- Etapa Carlos',
      nomePasta: 'BA-048 - Beatriz Nogueira - Divórcio',
      urlPasta: 'https://drive.google.com/drive/folders/beatriz-folder',
    },
    {
      etapa: '03- Etapa Gilmar',
      nomePasta: 'BA-051 - Rainara Oliveira Mendes',
      urlPasta: 'https://drive.google.com/drive/folders/rainara-folder',
    },
  ];

  const calendarEvents: AppsScriptCalendarEventRow[] = [
    {
      id: 'cal-1',
      titulo: 'Cobrança Honorários — Beatriz Nogueira',
      inicio: '2026-11-20T13:30:00-03:00',
      descricao: 'Parcela 1/6 (R$ 500,00)',
    },
    {
      id: 'cal-2',
      titulo: 'Cobrança Honorários — Mariana Souza Almeida',
      inicio: '2026-11-22T13:30:00-03:00',
      descricao: 'Parcela 2/6',
    },
  ];

  const signedDocs = normalizeZapSignDocsPayload([
    {
      // Matched to Mariana (c1) via exact CPF even though doc name is generic & Paulo Barreto is first signer
      token: 'zs-cpf-match',
      name: 'Contrato Padrão.pdf',
      status: 'signed',
      created_at: '2026-11-10T10:00:00Z',
      signers: [
        { name: 'Paulo Barreto', signed_at: '2026-11-10T10:05:00Z' },
        {
          name: 'Mariana S. A.',
          cpf: '123.456.789-01',
          phone_country: '55',
          phone_number: '11999990001',
          signed_at: '2026-11-10T12:00:00Z',
        },
      ],
    },
    {
      // Matched to Kennúbia (c2) via phonetic + preposition variation
      token: 'zs-phonetic-match',
      name: 'Contrato de Honorários Advocatícios.pdf',
      status: 'signed',
      created_at: '2026-11-10T10:00:00Z',
      signers: [
        { name: 'Kennúbya da Silva Pereira', signed_at: '2026-11-11T12:00:00Z' },
        { name: 'Barreto Advocacia', signed_at: '2026-11-11T12:05:00Z' },
      ],
    },
    {
      // Multi-holder dirty title matched to Rainara (c3) by extracted individual co-holder
      token: 'zs-multi-holder',
      name: ', Procuração e Declarações Rainara, Rayla e Luiz Felipe.docx',
      status: 'signed',
      created_at: '2026-11-12T10:00:00Z',
      signers: [{ name: 'Paulo Barreto', signed_at: '2026-11-12T10:15:00Z' }],
    },
    {
      // Missing from Sheets, BUT found in BOTH Drive (BA-048 prefix!) and Calendar
      token: 'zs-drive-and-calendar',
      name: 'Contrato de Honorários - Beatriz Nogueira.pdf',
      status: 'signed',
      created_at: '2026-11-13T09:00:00Z',
      signed_file: 'https://app.zapsign.com.br/signed/beatriz.pdf',
      signers: [
        {
          name: 'Beatriz Nogueira',
          cpf: '32165498700',
          phone_country: '55',
          phone_number: '61991112222',
          signed_at: '2026-11-14T18:20:00Z',
        },
      ],
    },
    {
      // Truly missing from Sheets, Drive, and Calendar
      token: 'zs-fully-pending',
      name: 'Procuração + Contrato.pdf',
      status: 'signed',
      created_at: '2026-11-15T10:00:00Z',
      signers: [
        {
          name: 'Fernanda Costa Alves',
          signed_at: '2026-11-15T11:30:00Z',
        },
      ],
    },
  ]);

  const result = matchZapSignToClients(
    mockClients,
    signedDocs,
    driveEtapas,
    calendarEvents
  );

  // 1. Mariana matched via CPF + Calendar detected
  assert.equal(result.matchedByClientId['c1']?.length, 1);
  const marianaAudit = result.allAuditItems.find(
    (i) => i.doc.token === 'zs-cpf-match'
  );
  assert.equal(marianaAudit?.linkageStatus, 'vinculado_planilha');
  assert.equal(marianaAudit?.matchedClientId, 'c1');
  assert.equal(marianaAudit?.matchScore, 100);
  assert.ok(marianaAudit?.matchedSources?.includes('Sheets'));
  assert.ok(marianaAudit?.matchedSources?.includes('Calendar'));

  // 2. Kennúbia matched phonetically
  assert.equal(result.matchedByClientId['c2']?.length, 1);

  // 3. Rainara matched from multi-holder dirty title
  assert.equal(result.matchedByClientId['c3']?.length, 1);
  const rainaraAudit = result.allAuditItems.find(
    (i) => i.doc.token === 'zs-multi-holder'
  );
  assert.equal(rainaraAudit?.linkageStatus, 'vinculado_planilha');
  assert.equal(rainaraAudit?.matchedClientName, 'Rainara Oliveira Mendes');
  assert.ok(rainaraAudit?.matchedSources?.includes('Drive'));

  // 4. Only 2 unmatched items remain (Fernanda & Beatriz)
  assert.equal(result.unmatchedAuditItems.length, 2);

  // Fernanda (newest): pendente_cadastro, no sources
  const fernandaItem = result.unmatchedAuditItems[0];
  assert.equal(fernandaItem.primarySignerName, 'Fernanda Costa Alves');
  assert.equal(fernandaItem.linkageStatus, 'pendente_cadastro');
  assert.deepEqual(fernandaItem.matchedSources, []);

  // Beatriz: vinculado_drive_ou_agenda_sem_planilha, Drive (BA-048 stripped!) + Calendar found + extracted CPF/phone
  const beatrizItem = result.unmatchedAuditItems[1];
  assert.equal(beatrizItem.primarySignerName, 'Beatriz Nogueira');
  assert.equal(
    beatrizItem.linkageStatus,
    'vinculado_drive_ou_agenda_sem_planilha'
  );
  assert.deepEqual(beatrizItem.matchedSources, ['Drive', 'Calendar']);
  assert.equal(beatrizItem.driveFolder?.etapa, '02- Etapa Carlos');
  assert.equal(
    beatrizItem.driveFolder?.urlPasta,
    'https://drive.google.com/drive/folders/beatriz-folder'
  );
  assert.equal(beatrizItem.calendarMatch?.eventCount, 1);
  assert.equal(beatrizItem.extractedProfile?.cpf, '321.654.987-00');
  assert.equal(beatrizItem.extractedProfile?.phone, '+55 61991112222');

  // Verify structured diagnostic object returned for EVERY document
  assert.equal(result.diagnostics.length, signedDocs.length);
  assert.equal(Object.keys(result.diagnosticsByToken).length, signedDocs.length);

  const marianaDiag = result.diagnosticsByToken['zs-cpf-match'];
  assert.ok(marianaDiag);
  assert.equal(marianaDiag.sources.sheets.matched, true);
  assert.equal(marianaDiag.sources.sheets.matchCriteria, 'cpf');
  assert.equal(marianaDiag.sources.zapsign.ignoredFirmSignersCount, 1);
  assert.equal(marianaDiag.sources.zapsign.clientSignersCount, 1);
  assert.equal(marianaDiag.sources.calendar.matched, true);
  assert.equal(marianaDiag.folderExclusion.excluded, false);

  const beatrizDiag = result.diagnosticsByToken['zs-drive-and-calendar'];
  assert.ok(beatrizDiag);
  assert.equal(beatrizDiag.normalizedTitle, 'Beatriz Nogueira');
  assert.equal(beatrizDiag.sources.sheets.matched, false);
  assert.equal(beatrizDiag.sources.drive.matched, true);
  assert.equal(beatrizDiag.sources.drive.etapa, '02- Etapa Carlos');
  assert.equal(beatrizDiag.sources.calendar.matched, true);
  assert.equal(beatrizDiag.linkageStatus, 'vinculado_drive_ou_agenda_sem_planilha');
  assert.deepEqual(beatrizItem.diagnostic, beatrizDiag);
});

test('normalizeZapSignTitle strips chained legal prefixes (Contrato,, Procuração Ad Judicia, Prestação de Serviços) and copy counters', () => {
  assert.equal(
    cleanZapSignDocumentTitle('Contrato, Maria Clara Nogueira (2).pdf'),
    'Maria Clara Nogueira'
  );
  assert.equal(
    cleanZapSignDocumentTitle(
      'Contrato de Prestação de Serviços Advocatícios - Carlos Eduardo Lima.docx.pdf'
    ),
    'Carlos Eduardo Lima'
  );
  assert.equal(
    cleanZapSignDocumentTitle(
      'Contrato de Honorários e Procuração Ad Judicia et Extra - Ana Paula Rocha - Assinatura.pdf'
    ),
    'Ana Paula Rocha'
  );
  assert.equal(
    cleanZapSignDocumentTitle(
      'Declaração de Hipossuficiência Econômica e Procuração - Pedro Henrique Alves.docx'
    ),
    'Pedro Henrique Alves'
  );

  const structured = normalizeZapSignTitle(
    'Contrato, Procuração e Declarações - Rainara, Rayla e Luiz Felipe - cópia.docx'
  );
  assert.equal(structured.normalizedTitle, 'Rainara, Rayla e Luiz Felipe');
  assert.deepEqual(structured.extractedNames, [
    'Rainara',
    'Rayla',
    'Luiz Felipe',
  ]);
  assert.equal(structured.isProcedural, false);
});

test('checkExcludedZapSignFolder and diagnoseZapSignDocument enforce rigid folder exclusions and Calendar CPF/phone linkage', () => {
  const zzCheck = checkExcludedZapSignFolder('/2026/ZZ-Encerrados/Cliente X');
  assert.equal(zzCheck.isExcluded, true);
  assert.equal(zzCheck.matchedRule, 'ZZ - Encerrados');
  assert.equal(zzCheck.isClosedArchive, true);

  const docsCheck = checkExcludedZapSignFolder('/Clientes/docs_faltavam/Subpasta');
  assert.equal(docsCheck.isExcluded, true);
  assert.equal(docsCheck.matchedRule, 'Docs Faltavam');
  assert.equal(docsCheck.isClosedArchive, false);

  const fechadosCheck = checkExcludedZapSignFolder(
    undefined,
    '  FECHADOS\u00A0DO\u200B ESCRITORIO!  '
  );
  assert.equal(fechadosCheck.isExcluded, true);
  assert.equal(fechadosCheck.matchedRule, 'Fechados do Escritório');

  assert.equal(
    normalizeRobustString(' [Docs.Faltavam]\u200B '),
    'docs faltavam'
  );
  assert.equal(
    checkExcludedZapSignFolder('/06 - [Docs.Faltavam]/2026').matchedRule,
    'Docs Faltavam'
  );

  const [excludedDoc, cpfCalDoc] = normalizeZapSignDocsPayload([
    {
      token: 'zs-rigid-excl',
      name: 'Contrato - Mariana Souza Almeida.pdf',
      status: 'signed',
      folder_path: '/Fechados do Escritório/2026',
      created_at: '2026-11-10T10:00:00Z',
      signers: [{ name: 'Mariana Souza Almeida', cpf: '12345678901' }],
    },
    {
      token: 'zs-cal-cpf',
      name: 'Contrato, Helena Duarte.pdf',
      status: 'signed',
      created_at: '2026-11-16T10:00:00Z',
      signers: [
        {
          name: 'Helena Duarte',
          cpf: '55566677788',
          phone_country: '55',
          phone_number: '61981234567',
          signed_at: '2026-11-16T12:00:00Z',
        },
      ],
    },
  ]);

  const exclDiag = diagnoseZapSignDocument(excludedDoc, mockClients, [], []);
  assert.equal(exclDiag.folderExclusion.excluded, true);
  assert.equal(exclDiag.folderExclusion.source, 'zapsign');
  assert.equal(exclDiag.folderExclusion.matchedRule, 'Fechados do Escritório');
  assert.equal(exclDiag.auditStatus, 'excluded_folder');
  assert.equal(exclDiag.sources.sheets.matched, false);

  const calEvents: AppsScriptCalendarEventRow[] = [
    {
      id: 'cal-cpf-1',
      titulo: 'Cobrança Parcela 1/4',
      inicio: '2026-11-25T14:00:00-03:00',
      descricao: 'Cliente CPF 555.666.777-88',
    },
  ];

  const calDiag = diagnoseZapSignDocument(cpfCalDoc, mockClients, [], calEvents);
  assert.equal(calDiag.normalizedTitle, 'Helena Duarte');
  assert.equal(calDiag.sources.sheets.matched, false);
  assert.equal(calDiag.sources.drive.matched, false);
  assert.equal(calDiag.sources.calendar.matched, true);
  assert.equal(calDiag.sources.calendar.eventCount, 1);
  assert.equal(calDiag.linkageStatus, 'vinculado_drive_ou_agenda_sem_planilha');
  assert.deepEqual(calDiag.matchedSources, ['Calendar']);
});

test('resilient matching handles typos, silent H, z/s variations, abbreviated initials, ambiguity guard, and malformed inputs', () => {
  // Silent H & z/s & typos
  assert.equal(isNameMatch('Helena Souza', 'Elena Sousa'), true);
  assert.equal(isNameMatch('Luiz Henrique Almeida', 'Luis Enrique Almeida'), true);
  assert.equal(isNameMatch('Beatriz Nogueira', 'Beartiz Noguera'), true);
  assert.equal(isNameMatch('Fernanda Oliveira', 'Fernada Olveira'), true);
  // Prevent gender-pair false positives on 5-letter first names
  assert.equal(isNameMatch('Maria Silva', 'Mario Silva'), false);
  // Abbreviated first name initial + matching surnames
  assert.equal(isNameMatch('M. Souza Almeida', 'Mariana Souza Almeida'), true);

  // Ambiguity safeguard: two clients sharing first name "Rainara" must NOT auto-link on single co-holder token
  const ambiguousClients: ClientCase[] = [
    ...mockClients,
    {
      id: 'c4',
      fullName: 'Rainara Costa Ribeiro',
      phone: '61977776666',
      caseType: 'Guarda',
      driveStage: '01- Etapa Luis',
      driveFolderUrl: 'https://drive.google.com/drive/folders/4',
      modality: 'Parcelado',
      contractedTotal: 2500,
      installments: [],
    },
  ];
  const [ambiguousDoc] = normalizeZapSignDocsPayload([
    {
      token: 'zs-ambig',
      name: ', Procuração e Declarações Rainara, Rayla e Luiz Felipe.docx',
      status: 'signed',
      created_at: '2026-11-12T10:00:00Z',
      signers: [{ name: 'Paulo Barreto' }],
    },
  ]);
  const ambigDiag = diagnoseZapSignDocument(ambiguousDoc, ambiguousClients, [], []);
  assert.equal(ambigDiag.sources.sheets.matched, false);
  assert.equal(ambigDiag.auditStatus, 'missing_in_spreadsheet');

  // Defensive resilience against malformed doc (missing signers array / empty signedAt)
  const malformedDoc = {
    token: 'zs-malformed',
    name: 'Contrato - Mariana Souza Almeida.pdf',
    status: 'signed' as const,
    createdAt: '',
    signedAt: '',
    signers: undefined as unknown as [],
  };
  const safeRes = matchZapSignToClients(mockClients, [malformedDoc], [], []);
  assert.equal(safeRes.diagnostics.length, 1);
  assert.equal(safeRes.diagnosticsByToken['zs-malformed'].sources.sheets.matched, true);
  assert.equal(safeRes.diagnosticsByToken['zs-malformed'].sources.sheets.clientId, 'c1');
});

test('folder exclusion rules block Drive stages (Docs Faltavam, Fechados do Escritório, ZZ - Encerrados) without falsely blocking active folders', () => {
  // Active folders with similar words must NOT be excluded
  assert.equal(isExcludedZapSignFolder('/01- Etapa Luis', '01- Etapa Luis'), false);
  assert.equal(isExcludedZapSignFolder('/Docs Enviados', 'Docs Enviados'), false);
  assert.equal(isExcludedZapSignFolder('/Fechamento Mensal', 'Fechamento Mensal'), false);

  const driveEtapas: AppsScriptDriveEtapaRow[] = [
    {
      etapa: 'Docs Faltavam',
      nomePasta: 'BA-071 - Juliana Martins Prado',
      urlPasta: 'https://drive.google.com/drive/folders/juliana-docs',
    },
    {
      etapa: 'Fechados do Escritório',
      nomePasta: 'BA-072 - Marcos Vinícius Rocha',
      urlPasta: 'https://drive.google.com/drive/folders/marcos-fechado',
    },
  ];

  const signedDocs = normalizeZapSignDocsPayload([
    {
      token: 'zs-drive-docs-faltavam',
      name: 'Contrato, Juliana Martins Prado.pdf',
      status: 'signed',
      created_at: '2026-11-17T10:00:00Z',
      signers: [{ name: 'Juliana Martins Prado', signed_at: '2026-11-17T12:00:00Z' }],
    },
    {
      token: 'zs-drive-fechados',
      name: 'Procuração - Marcos Vinícius Rocha.docx',
      status: 'signed',
      created_at: '2026-11-18T10:00:00Z',
      signers: [{ name: 'Marcos Vinícius Rocha', signed_at: '2026-11-18T12:00:00Z' }],
    },
  ]);

  const result = matchZapSignToClients(mockClients, signedDocs, driveEtapas, []);

  assert.equal(result.unmatchedAuditItems.length, 0);
  assert.equal(result.unmatchedDocs.length, 0);
  assert.equal(result.excludedFolderItems.length, 2);

  const julianaDiag = result.diagnosticsByToken['zs-drive-docs-faltavam'];
  assert.equal(julianaDiag.folderExclusion.excluded, true);
  assert.equal(julianaDiag.folderExclusion.source, 'drive');
  assert.equal(julianaDiag.folderExclusion.matchedRule, 'Docs Faltavam');
  assert.equal(julianaDiag.auditStatus, 'excluded_folder');

  const marcosDiag = result.diagnosticsByToken['zs-drive-fechados'];
  assert.equal(marcosDiag.folderExclusion.excluded, true);
  assert.equal(marcosDiag.folderExclusion.source, 'drive');
  assert.equal(marcosDiag.folderExclusion.matchedRule, 'Fechados do Escritório');
  assert.equal(marcosDiag.auditStatus, 'excluded_folder');
});

test('document title cleaning removes additional legal prefixes (Contrato,, Termo de Ciência, Aditivo, Distrato, Substabelecimento)', () => {
  assert.equal(
    cleanZapSignDocumentTitle('Contrato, Gabriel Henrique Costa - Divórcio.pdf'),
    'Gabriel Henrique Costa'
  );
  assert.equal(
    cleanZapSignDocumentTitle('Termo de Ciência e Responsabilidade - Larissa Mota.docx'),
    'Larissa Mota'
  );
  assert.equal(
    cleanZapSignDocumentTitle('Aditivo de Contrato de Honorários - Rodrigo Teixeira (1).pdf'),
    'Rodrigo Teixeira'
  );
  assert.equal(
    cleanZapSignDocumentTitle('Distrato - Vanessa Lopes Ferreira - Assinado.pdf'),
    'Vanessa Lopes Ferreira'
  );
  assert.equal(
    cleanZapSignDocumentTitle('Substabelecimento - Eduardo Campos.pdf'),
    'Eduardo Campos'
  );
});

test('multi-source cross-linkage succeeds across Sheets + Drive + Calendar via full name, phone, email, and Drive-assisted reconciliation', () => {
  const extendedClients: ClientCase[] = [
    ...mockClients,
    {
      id: 'c-email',
      fullName: 'Patrícia Rezende Campos',
      phone: '61984445555',
      caseType: 'Guarda Compartilhada',
      driveStage: '02- Etapa Carlos',
      driveFolderUrl: 'https://drive.google.com/drive/folders/patricia',
      modality: 'Parcelado',
      contractedTotal: 3600,
      notes: 'Contato principal: patricia.rezende@example.com',
      installments: [],
    },
  ];

  const driveEtapas: AppsScriptDriveEtapaRow[] = [
    {
      etapa: '02- Etapa Carlos',
      nomePasta: 'BA-080 - Mariana Souza Almeida - Divórcio',
      urlPasta: 'https://drive.google.com/drive/folders/mariana-drive',
    },
    {
      etapa: '02- Etapa Carlos',
      nomePasta: 'BA-081 - Patrícia Rezende Campos',
      urlPasta: 'https://drive.google.com/drive/folders/patricia-drive',
    },
    {
      etapa: '01- Etapa Luis',
      nomePasta: 'BA-082 - Kennúbia Silva Pereira - Pensão',
      urlPasta: 'https://drive.google.com/drive/folders/kennubia-drive',
    },
  ];

  const calendarEvents: AppsScriptCalendarEventRow[] = [
    {
      id: 'cal-mariana-1',
      titulo: 'Cobrança Honorários — Mariana Souza Almeida',
      inicio: '2026-11-20T10:00:00-03:00',
      descricao: 'Parcela 3/6',
    },
    {
      id: 'cal-patricia-email',
      titulo: 'Vencimento Parcela 2/6',
      inicio: '2026-11-24T15:00:00-03:00',
      descricao: 'Enviar boleto para patricia.rezende@example.com',
    },
    {
      id: 'cal-kennubia-phone',
      titulo: 'Cobrança Parcela 1/4',
      inicio: '2026-11-26T09:00:00-03:00',
      descricao: 'WhatsApp (11) 99999-0002',
    },
  ];

  const signedDocs = normalizeZapSignDocsPayload([
    {
      // Full 3-source match: Sheets + Drive + Calendar
      token: 'zs-all-three',
      name: 'Contrato, Procuração e Declarações - Mariana Souza Almeida.pdf',
      status: 'signed',
      created_at: '2026-11-18T10:00:00Z',
      signers: [
        {
          name: 'Mariana Souza Almeida',
          cpf: '12345678901',
          phone_country: '55',
          phone_number: '11999990001',
          signed_at: '2026-11-18T14:00:00Z',
        },
      ],
    },
    {
      // Matched to Patrícia via email in Sheets notes + Calendar email + Drive
      token: 'zs-email-match',
      name: 'Contrato Padrão.pdf',
      status: 'signed',
      created_at: '2026-11-19T10:00:00Z',
      signers: [
        {
          name: 'P. R. C.',
          email: 'patricia.rezende@example.com',
          signed_at: '2026-11-19T11:00:00Z',
        },
      ],
    },
    {
      // Matched to Kennúbia via phone-only in Sheets + Drive + Calendar phone
      token: 'zs-phone-match',
      name: 'Contrato de Honorários.pdf',
      status: 'signed',
      created_at: '2026-11-19T12:00:00Z',
      signers: [
        {
          name: 'K. S. P.',
          phone_country: '55',
          phone_number: '11999990002',
          signed_at: '2026-11-19T13:00:00Z',
        },
      ],
    },
  ]);

  const result = matchZapSignToClients(
    extendedClients,
    signedDocs,
    driveEtapas,
    calendarEvents
  );

  assert.equal(result.unmatchedAuditItems.length, 0);
  assert.equal(result.matchedByClientId['c1']?.length, 1);
  assert.equal(result.matchedByClientId['c-email']?.length, 1);
  assert.equal(result.matchedByClientId['c2']?.length, 1);

  const marianaDiag = result.diagnosticsByToken['zs-all-three'];
  assert.equal(marianaDiag.auditStatus, 'matched_spreadsheet');
  assert.equal(marianaDiag.linkageStatus, 'vinculado_planilha');
  assert.deepEqual(marianaDiag.matchedSources, ['Sheets', 'Drive', 'Calendar']);
  assert.equal(marianaDiag.sources.sheets.matched, true);
  assert.equal(marianaDiag.sources.drive.matched, true);
  assert.equal(marianaDiag.sources.calendar.matched, true);

  const patriciaDiag = result.diagnosticsByToken['zs-email-match'];
  assert.equal(patriciaDiag.auditStatus, 'matched_spreadsheet');
  assert.equal(patriciaDiag.sources.sheets.clientId, 'c-email');
  assert.deepEqual(patriciaDiag.matchedSources, ['Sheets', 'Drive', 'Calendar']);
  assert.equal(patriciaDiag.sources.calendar.matched, true);

  const kennubiaDiag = result.diagnosticsByToken['zs-phone-match'];
  assert.equal(kennubiaDiag.auditStatus, 'matched_spreadsheet');
  assert.equal(kennubiaDiag.sources.sheets.clientId, 'c2');
  assert.equal(kennubiaDiag.sources.sheets.matchCriteria, 'phone');
  assert.deepEqual(kennubiaDiag.matchedSources, ['Sheets', 'Drive', 'Calendar']);
});

test('formatZapSignDateBR converts ISO timestamps into dd/mm/yyyy', () => {
  assert.equal(formatZapSignDateBR('2026-11-14T18:20:00Z'), '14/11/2026');
  assert.equal(formatZapSignDateBR('2026-11-05'), '05/11/2026');
  assert.equal(formatZapSignDateBR(''), '');
});
