import {
  ClientCase,
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

const IGNORED_NAME_TOKENS = new Set([
  'da',
  'de',
  'do',
  'das',
  'dos',
  'e',
  'silva',
  'souza',
  'santos',
  'oliveira',
  'pereira',
  'costa',
  'rodrigues',
  'almeida',
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

function isNameMatch(clientFullName: string, candidateText: string): boolean {
  const normClient = normalizeText(clientFullName);
  const normCandidate = normalizeText(candidateText);
  if (!normClient || !normCandidate) return false;

  if (
    normCandidate === normClient ||
    normCandidate.includes(normClient) ||
    normClient.includes(normCandidate)
  ) {
    return true;
  }

  const clientTokens = normClient.split(' ').filter((t) => t.length >= 3);
  const candidateTokens = new Set(
    normCandidate.split(' ').filter((t) => t.length >= 3)
  );
  if (clientTokens.length < 2) return false;

  const matched = clientTokens.filter((t) => candidateTokens.has(t));
  const distinctiveMatched = matched.filter((t) => !IGNORED_NAME_TOKENS.has(t));

  return matched.length >= 2 && distinctiveMatched.length >= 1;
}

export function matchZapSignToClients(
  clients: ClientCase[],
  signedDocs: ZapSignSignedDoc[]
): {
  matchedByClientId: Record<string, ZapSignSignedDoc[]>;
  unmatchedDocs: ZapSignSignedDoc[];
} {
  const matchedByClientId: Record<string, ZapSignSignedDoc[]> = {};
  const unmatchedDocs: ZapSignSignedDoc[] = [];

  for (const doc of signedDocs) {
    let matchedAnyClient = false;

    for (const client of clients) {
      const signerMatches = doc.signers.some((s) =>
        isNameMatch(client.fullName, s.name)
      );
      const docNameMatches = isNameMatch(client.fullName, doc.name);

      if (signerMatches || docNameMatches) {
        matchedAnyClient = true;
        if (!matchedByClientId[client.id]) {
          matchedByClientId[client.id] = [];
        }
        matchedByClientId[client.id].push(doc);
      }
    }

    if (!matchedAnyClient) {
      unmatchedDocs.push(doc);
    }
  }

  // Sort each client's docs newest signed first
  for (const clientId of Object.keys(matchedByClientId)) {
    matchedByClientId[clientId].sort((a, b) =>
      b.signedAt.localeCompare(a.signedAt)
    );
  }

  return { matchedByClientId, unmatchedDocs };
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
