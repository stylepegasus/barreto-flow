import {
  AppsScriptDriveEtapaRow,
  ClientCase,
  ZapSignCrossReferenceItem,
  ZapSignDriveFolderInfo,
  ZapSignSignedDoc,
  ZapSignSigner,
} from '../types/honorarios';
import { normalizeText } from './sheetArchitecture';

interface RawZapSignSigner {
  name?: unknown;
  email?: unknown;
  phone_country?: unknown;
  phone_number?: unknown;
  signed_at?: unknown;
}

interface RawZapSignDoc {
  token?: unknown;
  name?: unknown;
  status?: unknown;
  created_at?: unknown;
  last_update_at?: unknown;
  signed_file?: unknown;
  signers?: unknown;
}

const PREPOSITION_TOKENS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

const COMMON_SURNAME_TOKENS = new Set([
  'silva',
  'souza',
  'sousa',
  'santos',
  'oliveira',
  'pereira',
  'costa',
  'rodrigues',
  'almeida',
  'ferreira',
  'lima',
  'gomes',
  'ribeiro',
  'carvalho',
  'alves',
  'monteiro',
]);

function extractPhone(raw: RawZapSignSigner): string | undefined {
  const num = String(raw.phone_number ?? '').trim();
  if (!num) return undefined;
  const country = String(raw.phone_country ?? '').trim();
  return country ? `+${country.replace(/\D/g, '')} ${num}` : num;
}

/**
 * Normalizes ZapSign API document objects and STRICTLY keeps only status === 'signed'.
 */
export function normalizeZapSignDocsPayload(
  rawDocs: unknown[]
): ZapSignSignedDoc[] {
  const docs: ZapSignSignedDoc[] = [];

  for (const entry of rawDocs) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as RawZapSignDoc;
    const status = String(raw.status ?? '')
      .trim()
      .toLowerCase();

    // STRICTLY signed only; ignore pending, link-opened, canceled, etc.
    if (status !== 'signed') continue;

    const token = String(raw.token ?? '').trim();
    const name = String(raw.name ?? '').trim();
    if (!token || !name) continue;

    const rawSigners = Array.isArray(raw.signers) ? raw.signers : [];
    const signers: ZapSignSigner[] = rawSigners
      .filter((s): s is RawZapSignSigner => Boolean(s && typeof s === 'object'))
      .map((s) => ({
        name: String(s.name ?? '').trim(),
        email: String(s.email ?? '').trim() || undefined,
        phone: extractPhone(s),
        signedAt: String(s.signed_at ?? '').trim() || undefined,
      }))
      .filter((s) => Boolean(s.name));

    const latestSignerDate = signers
      .map((s) => s.signedAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop();

    const createdAt = String(raw.created_at ?? '').trim();
    const signedAt =
      latestSignerDate ||
      String(raw.last_update_at ?? '').trim() ||
      createdAt;

    const signedFileUrl = String(raw.signed_file ?? '').trim() || undefined;

    docs.push({
      token,
      name,
      status: 'signed',
      createdAt,
      signedAt,
      signedFileUrl,
      signers,
    });
  }

  return docs;
}

/**
 * Strips accents, punctuation, and Portuguese prepositions (da, de, do, das, dos, e).
 */
export function normalizePersonTokens(value: string): string[] {
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!base) return [];
  return base
    .split(' ')
    .filter((token) => token.length > 0 && !PREPOSITION_TOKENS.has(token));
}

/**
 * Phonetic normalization for Portuguese names/spelling variations
 * (e.g. "Kennúbia" <-> "Kennúbya", "Anna" <-> "Ana", "Thiago" <-> "Tiago", "Philipe" <-> "Filipe").
 */
export function phoneticNormalizeToken(token: string): string {
  return token
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/y/g, 'i')
    .replace(/w/g, 'v')
    .replace(/k/g, 'c')
    .replace(/qu/g, 'c')
    .replace(/ç/g, 's')
    .replace(/([a-z])\1+/g, '$1')
    .trim();
}

function tokensEqualWithTolerance(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return phoneticNormalizeToken(a) === phoneticNormalizeToken(b);
}

function cleanDocumentTitleForName(docName: string): string {
  return docName
    .replace(/\.pdf$/i, '')
    .replace(
      /\b(contrato|honorarios|procuracao|declaracao|termo|ads|familia|assinado)\b/gi,
      ' '
    )
    .replace(/[-–_|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDriveFolderDecorators(folderName: string): string {
  return folderName
    .replace(/^\d+\s*[-–._]\s*/, '')
    .replace(
      /\s*[-–]\s*(divorcio|pensao|guarda|alimentos|inventario|familia|regulamentacao|uniao).*$/i,
      ''
    )
    .trim();
}

export function isNameMatch(nameA: string, nameB: string): boolean {
  const tokensA = normalizePersonTokens(nameA);
  const tokensB = normalizePersonTokens(nameB);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const fullA = tokensA.join(' ');
  const fullB = tokensB.join(' ');

  // 1. Exact preposition-stripped match or phonetic full match
  if (fullA === fullB) return true;
  if (
    phoneticNormalizeToken(tokensA.join('')) ===
    phoneticNormalizeToken(tokensB.join(''))
  ) {
    return true;
  }

  // 2. Clean containment when one side has at least 2 tokens
  const minTokensCount = Math.min(tokensA.length, tokensB.length);
  if (
    minTokensCount >= 2 &&
    (fullA.includes(fullB) || fullB.includes(fullA))
  ) {
    return true;
  }

  // 3. First name + last surname match (exact or phonetic)
  if (tokensA.length >= 2 && tokensB.length >= 2) {
    const firstMatch = tokensEqualWithTolerance(tokensA[0], tokensB[0]);
    const lastMatch = tokensEqualWithTolerance(
      tokensA[tokensA.length - 1],
      tokensB[tokensB.length - 1]
    );
    if (firstMatch && lastMatch) {
      return true;
    }
  }

  // 4. Multi-token overlap (at least 2 matching tokens and at least 1 non-common surname/given name)
  if (tokensA.length >= 2 && tokensB.length >= 2) {
    const matchedTokens: string[] = [];
    for (const ta of tokensA) {
      if (ta.length < 3) continue;
      if (tokensB.some((tb) => tokensEqualWithTolerance(ta, tb))) {
        matchedTokens.push(ta);
      }
    }
    const distinctiveMatched = matchedTokens.filter(
      (t) => !COMMON_SURNAME_TOKENS.has(t)
    );
    if (matchedTokens.length >= 2 && distinctiveMatched.length >= 1) {
      return true;
    }
  }

  return false;
}

export function isClosedDriveStage(etapa?: string): boolean {
  const norm = normalizeText(etapa ?? '');
  if (!norm) return false;
  return norm.includes('encerrad') || /^zz\b/.test(norm);
}

export function isClientClosedOrCanceled(client: ClientCase): boolean {
  if (isClosedDriveStage(client.rawDriveStage ?? client.driveStage)) {
    return true;
  }
  const notesNorm = normalizeText(client.notes ?? '');
  return notesNorm.includes('encerrad') || notesNorm.includes('cancelad');
}

function isFirmSignerName(name: string): boolean {
  const norm = normalizeText(name);
  return (
    norm.includes('barreto advocacia') ||
    norm === 'barreto' ||
    norm.includes('escritorio barreto')
  );
}

export function extractPrimarySignerName(doc: ZapSignSignedDoc): string {
  const nonFirmSigners = doc.signers
    .map((s) => s.name.trim())
    .filter((n) => n.length > 0 && !isFirmSignerName(n));

  if (nonFirmSigners.length > 0) {
    return nonFirmSigners[0];
  }

  const firstSigner = doc.signers[0]?.name?.trim();
  if (firstSigner) return firstSigner;

  const cleanedTitle = cleanDocumentTitleForName(doc.name);
  return cleanedTitle || doc.name;
}

function getCandidateNamesForDoc(doc: ZapSignSignedDoc): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const pushUnique = (val?: string) => {
    const trimmed = (val ?? '').trim();
    if (!trimmed || isFirmSignerName(trimmed)) return;
    const key = normalizeText(trimmed);
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(trimmed);
    }
  };

  // Prioritize signers[0].name and remaining signers first
  for (const s of doc.signers) {
    pushUnique(s.name);
  }

  // Fallback to cleaned document title and raw document title
  pushUnique(cleanDocumentTitleForName(doc.name));
  pushUnique(doc.name);

  return ordered;
}

function findMatchingDriveFolder(
  candidateNames: string[],
  driveEtapas: AppsScriptDriveEtapaRow[]
): ZapSignDriveFolderInfo | undefined {
  if (!driveEtapas || driveEtapas.length === 0) return undefined;

  for (const candidate of candidateNames) {
    for (const folder of driveEtapas) {
      const nomePasta = String(folder.nomePasta ?? '').trim();
      if (!nomePasta) continue;
      const strippedPasta = stripDriveFolderDecorators(nomePasta);

      if (isNameMatch(candidate, strippedPasta) || isNameMatch(candidate, nomePasta)) {
        const etapa = String(folder.etapa ?? '').trim() || 'Drive';
        const urlPasta =
          String(folder.urlPasta ?? '').trim() ||
          'https://drive.google.com/drive/my-drive';
        return {
          etapa,
          nomePasta,
          urlPasta,
          isClosed: isClosedDriveStage(etapa),
        };
      }
    }
  }

  return undefined;
}

export interface ZapSignMatchResult {
  matchedByClientId: Record<string, ZapSignSignedDoc[]>;
  unmatchedDocs: ZapSignSignedDoc[];
  unmatchedAuditItems: ZapSignCrossReferenceItem[];
  closedAuditItems: ZapSignCrossReferenceItem[];
  allAuditItems: ZapSignCrossReferenceItem[];
}

/**
 * Performs 3-way cross-referencing:
 * 1) ZapSign signed documents (prioritizing signers[0].name)
 * 2) Honorários spreadsheet (`clients`)
 * 3) Google Drive folders (`driveEtapas`), excluding `ZZ - Encerrados` ("Encerrado (não cobrar)")
 */
export function matchZapSignToClients(
  clients: ClientCase[],
  signedDocs: ZapSignSignedDoc[],
  driveEtapas: AppsScriptDriveEtapaRow[] = []
): ZapSignMatchResult {
  const matchedByClientId: Record<string, ZapSignSignedDoc[]> = {};
  const unmatchedDocs: ZapSignSignedDoc[] = [];
  const unmatchedAuditItems: ZapSignCrossReferenceItem[] = [];
  const closedAuditItems: ZapSignCrossReferenceItem[] = [];
  const allAuditItems: ZapSignCrossReferenceItem[] = [];

  for (const doc of signedDocs) {
    const primarySignerName = extractPrimarySignerName(doc);
    const candidateNames = getCandidateNamesForDoc(doc);

    const matchedClients: ClientCase[] = [];
    for (const client of clients) {
      const matched = candidateNames.some((candidate) =>
        isNameMatch(client.fullName, candidate)
      );
      if (matched) {
        matchedClients.push(client);
      }
    }

    const primaryMatchedClient = matchedClients[0];
    let driveFolder = findMatchingDriveFolder(candidateNames, driveEtapas);

    if (
      !driveFolder &&
      primaryMatchedClient &&
      primaryMatchedClient.driveFolderUrl &&
      !primaryMatchedClient.driveFolderUrl.endsWith('/my-drive')
    ) {
      const etapa =
        primaryMatchedClient.rawDriveStage ?? primaryMatchedClient.driveStage;
      driveFolder = {
        etapa,
        nomePasta: primaryMatchedClient.fullName,
        urlPasta: primaryMatchedClient.driveFolderUrl,
        isClosed: isClosedDriveStage(etapa),
      };
    }

    const isClosed =
      Boolean(driveFolder?.isClosed) ||
      matchedClients.some((c) => isClientClosedOrCanceled(c));

    if (matchedClients.length > 0) {
      for (const client of matchedClients) {
        if (!matchedByClientId[client.id]) {
          matchedByClientId[client.id] = [];
        }
        matchedByClientId[client.id].push(doc);
      }
    }

    if (isClosed) {
      const closedItem: ZapSignCrossReferenceItem = {
        doc,
        primarySignerName,
        auditStatus: 'closed_archive',
        inSpreadsheet: matchedClients.length > 0,
        matchedClient: primaryMatchedClient,
        driveFolder,
      };
      closedAuditItems.push(closedItem);
      allAuditItems.push(closedItem);
      continue;
    }

    if (matchedClients.length > 0) {
      allAuditItems.push({
        doc,
        primarySignerName,
        auditStatus: 'matched_spreadsheet',
        inSpreadsheet: true,
        matchedClient: primaryMatchedClient,
        driveFolder,
      });
      continue;
    }

    // Truly signed, NOT in spreadsheet, and NOT in ZZ - Encerrados
    unmatchedDocs.push(doc);
    const missingItem: ZapSignCrossReferenceItem = {
      doc,
      primarySignerName,
      auditStatus: 'missing_in_spreadsheet',
      inSpreadsheet: false,
      driveFolder,
    };
    unmatchedAuditItems.push(missingItem);
    allAuditItems.push(missingItem);
  }

  for (const clientId of Object.keys(matchedByClientId)) {
    matchedByClientId[clientId].sort((a, b) =>
      b.signedAt.localeCompare(a.signedAt)
    );
  }

  unmatchedAuditItems.sort((a, b) =>
    b.doc.signedAt.localeCompare(a.doc.signedAt)
  );
  unmatchedDocs.sort((a, b) => b.signedAt.localeCompare(a.signedAt));

  return {
    matchedByClientId,
    unmatchedDocs,
    unmatchedAuditItems,
    closedAuditItems,
    allAuditItems,
  };
}

export function formatZapSignDateBR(isoOrDate?: string): string {
  if (!isoOrDate) return '';
  const match = isoOrDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const dt = new Date(isoOrDate);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toLocaleDateString('pt-BR');
  }
  return isoOrDate;
}
