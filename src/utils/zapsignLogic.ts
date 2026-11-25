import type {
  AppsScriptCalendarEventRow,
  AppsScriptDriveEtapaRow,
  ClientCase,
  ZapSignAuditStatus,
  ZapSignCalendarMatchInfo,
  ZapSignCrossReferenceItem,
  ZapSignDocumentDiagnostic,
  ZapSignDriveFolderInfo,
  ZapSignExtractedProfile,
  ZapSignFolderExclusionDiagnostic,
  ZapSignLinkageStatus,
  ZapSignNormalizedTitle,
  ZapSignSignedDoc,
  ZapSignSigner,
  ZapSignSourceName,
} from '../types/honorarios.ts';
import { normalizeText } from './sheetArchitecture.ts';

// ---------------------------------------------------------------------------
// 1. Constants & Rigid Folder Exclusion Rules
// ---------------------------------------------------------------------------

export const EXCLUDED_ZAPSIGN_FOLDERS = [
  'ZZ - Encerrados',
  'Docs Faltavam',
  'Fechados do Escritório',
] as const;

export type ExcludedZapSignFolder = (typeof EXCLUDED_ZAPSIGN_FOLDERS)[number];

interface ExcludedFolderRule {
  label: ExcludedZapSignFolder;
  normalized: string;
  compact: string;
}

const EXCLUDED_FOLDER_RULES: ExcludedFolderRule[] =
  EXCLUDED_ZAPSIGN_FOLDERS.map((label) => {
    const normalized = normalizeFolderKey(label);
    return {
      label,
      normalized,
      compact: normalized.replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim(),
    };
  });

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
  'martins',
  'araujo',
  'melo',
  'barbosa',
  'rocha',
  'dias',
  'nascimento',
]);

const GENERIC_NON_NAME_WORDS = new Set([
  'contrato',
  'contratos',
  'honorarios',
  'advocaticios',
  'prestacao',
  'servicos',
  'procuracao',
  'procuracoes',
  'judicia',
  'extra',
  'ad',
  'et',
  'declaracao',
  'declaracoes',
  'distrato',
  'substabelecimento',
  'termo',
  'termos',
  'assinatura',
  'assinado',
  'assinada',
  'processo',
  'processual',
  'interdicao',
  'curatela',
  'divorcio',
  'pensao',
  'alimentos',
  'guarda',
  'visitas',
  'inventario',
  'familia',
  'regulamentacao',
  'uniao',
  'estavel',
  'partilha',
  'execucao',
  'revisional',
  'exoneracao',
  'paternidade',
  'aditivo',
  'aditamento',
  'acordo',
  'peticao',
  'inicial',
  'emenda',
  'hipossuficiencia',
  'justica',
  'gratuita',
  'ciencia',
  'ads',
  'padrao',
  'cliente',
  'clientes',
  'documento',
  'documentos',
  'docs',
  'copia',
  'novo',
  'nova',
  'atualizado',
  'atualizada',
  'final',
  'pdf',
  'docx',
  'doc',
]);

const PLACEHOLDER_PHONES = new Set([
  '11999999999',
  '99999999999',
  '00000000000',
]);

interface RawZapSignSigner {
  name?: unknown;
  email?: unknown;
  phone_country?: unknown;
  phone_number?: unknown;
  cpf?: unknown;
  cpf_number?: unknown;
  tax_id?: unknown;
  document?: unknown;
  signed_at?: unknown;
}

interface RawZapSignDoc {
  token?: unknown;
  name?: unknown;
  status?: unknown;
  created_at?: unknown;
  last_update_at?: unknown;
  signed_file?: unknown;
  folder_path?: unknown;
  folder_name?: unknown;
  folder?: unknown;
  signers?: unknown;
}

/**
 * Robust string normalization for Barreto Flow folder & entity matching:
 * strips zero-width characters, NBSP, accents/diacritics, and punctuation separators.
 */
export function normalizeRobustString(value?: string): string {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[._/\\\-–—[\](){}:;,!?|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFolderKey(value: string): string {
  return normalizeRobustString(value);
}

export interface FolderExclusionMatch {
  isExcluded: boolean;
  matchedRule?: ExcludedZapSignFolder;
  folderLabel?: string;
  isClosedArchive: boolean;
}

function matchesFolderRuleTokenBoundary(
  normalizedSegment: string,
  normalizedRule: string
): boolean {
  if (!normalizedSegment || !normalizedRule) return false;
  if (normalizedSegment === normalizedRule) return true;
  const paddedSeg = ` ${normalizedSegment} `;
  const paddedRule = ` ${normalizedRule} `;
  return paddedSeg.includes(paddedRule);
}

/**
 * Rigid check against the mandatory excluded folders:
 * 'ZZ - Encerrados', 'Docs Faltavam', and 'Fechados do Escritório'.
 * Uses robust normalization (case, accents, NBSP, zero-width chars, punctuation,
 * underscores, hyphens, and nested path segments).
 */
export function checkExcludedZapSignFolder(
  folderPath?: string,
  folderName?: string
): FolderExclusionMatch {
  const candidates = [folderPath, folderName]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    return { isExcluded: false, isClosedArchive: false };
  }

  for (const raw of candidates) {
    const rawSegments = raw
      .split(/[/\\]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const toCheck = [...rawSegments, raw];

    for (const rawSeg of toCheck) {
      const segNorm = normalizeFolderKey(rawSeg);
      if (!segNorm) continue;

      for (const rule of EXCLUDED_FOLDER_RULES) {
        if (matchesFolderRuleTokenBoundary(segNorm, rule.compact)) {
          return {
            isExcluded: true,
            matchedRule: rule.label,
            folderLabel: folderName || rawSeg || folderPath,
            isClosedArchive: rule.label === 'ZZ - Encerrados',
          };
        }
      }

      if (/^zz\b/.test(segNorm) && /\bencerrad/.test(segNorm)) {
        return {
          isExcluded: true,
          matchedRule: 'ZZ - Encerrados',
          folderLabel: folderName || rawSeg || folderPath,
          isClosedArchive: true,
        };
      }
    }
  }

  return { isExcluded: false, isClosedArchive: false };
}

export function isExcludedZapSignFolder(
  folderPath?: string,
  folderName?: string
): boolean {
  return checkExcludedZapSignFolder(folderPath, folderName).isExcluded;
}

export function isClosedDriveStage(etapa?: string): boolean {
  const norm = normalizeText(etapa ?? '');
  if (!norm) return false;
  return norm.includes('encerrad') || /^zz\b/.test(norm);
}

export function isExcludedAuditFolder(folderOrStage?: string): boolean {
  return (
    isClosedDriveStage(folderOrStage) ||
    isExcludedZapSignFolder(folderOrStage, folderOrStage)
  );
}

export function isProceduralDocumentTitle(docName: string): boolean {
  const trimmed = String(docName ?? '').trim();
  return /^processo[\s_:\-–—]/i.test(trimmed);
}

// ---------------------------------------------------------------------------
// 2. Payload & Identifier Normalization (CPF, Phone, ZapSign API Payload)
// ---------------------------------------------------------------------------

export function normalizeCPF(value?: string): string | undefined {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return undefined;
  if (/^(\d)\1{10}$/.test(digits)) return undefined;
  return digits;
}

export function formatCPF(digits?: string): string | undefined {
  const clean = normalizeCPF(digits);
  if (!clean) return undefined;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9)}`;
}

export function normalizePhoneDigits(value?: string): string | undefined {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  // Strip leading Brazil country code 55 when full E.164 (12 or 13 digits)
  if (digits.length >= 12 && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  if (digits.length < 10) return undefined;
  if (PLACEHOLDER_PHONES.has(digits)) return undefined;
  if (/^(\d)\1+$/.test(digits)) return undefined;
  return digits;
}

function phonesMatch(phoneA?: string, phoneB?: string): boolean {
  const a = normalizePhoneDigits(phoneA);
  const b = normalizePhoneDigits(phoneB);
  if (!a || !b) return false;
  if (a === b) return true;
  // Handle optional 9th digit on mobile numbers with same DDD + last 8 digits
  if (a.slice(0, 2) === b.slice(0, 2) && a.slice(-8) === b.slice(-8)) {
    return true;
  }
  return false;
}

function extractCPFInText(text?: string): string | undefined {
  if (!text) return undefined;
  const formattedMatch = text.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
  return formattedMatch ? normalizeCPF(formattedMatch[0]) : undefined;
}

function extractClientCPF(client: ClientCase): string | undefined {
  const direct = normalizeCPF(client.cpf);
  if (direct) return direct;
  return extractCPFInText(`${client.caseType ?? ''} ${client.notes ?? ''}`);
}

function extractPhone(raw: RawZapSignSigner): string | undefined {
  const num = String(raw.phone_number ?? '').trim();
  if (!num) return undefined;
  const country = String(raw.phone_country ?? '').trim();
  return country ? `+${country.replace(/\D/g, '')} ${num}` : num;
}

function extractSignerCpf(raw: RawZapSignSigner): string | undefined {
  const rawCpf = raw.cpf ?? raw.cpf_number ?? raw.tax_id ?? raw.document;
  const clean = normalizeCPF(String(rawCpf ?? ''));
  return formatCPF(clean);
}

function extractDocFolderMeta(raw: RawZapSignDoc): {
  folderPath?: string;
  folderName?: string;
} {
  let folderPath = String(raw.folder_path ?? '').trim() || undefined;
  let folderName = String(raw.folder_name ?? '').trim() || undefined;

  if (typeof raw.folder === 'string' && raw.folder.trim()) {
    const val = raw.folder.trim();
    if (val.includes('/') || val.includes('\\')) {
      folderPath = folderPath || val;
    } else {
      folderName = folderName || val;
    }
  } else if (raw.folder && typeof raw.folder === 'object') {
    const obj = raw.folder as Record<string, unknown>;
    const objPath = String(obj.path ?? obj.folder_path ?? '').trim();
    const objName = String(obj.name ?? obj.folder_name ?? '').trim();
    if (objPath) folderPath = folderPath || objPath;
    if (objName) folderName = folderName || objName;
  }

  if (!folderName && folderPath) {
    const lastSeg = folderPath
      .split(/[/\\]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    if (lastSeg) folderName = lastSeg;
  }

  return { folderPath, folderName };
}

/**
 * Normalizes ZapSign API document objects and STRICTLY keeps only status === 'signed'.
 * Preserves folder_path/folder metadata and signer CPF/phone/email for multi-source auditing.
 */
export function normalizeZapSignDocsPayload(
  rawDocs: unknown[]
): ZapSignSignedDoc[] {
  if (!Array.isArray(rawDocs)) return [];
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
        cpf: extractSignerCpf(s),
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
    const { folderPath, folderName } = extractDocFolderMeta(raw);

    docs.push({
      token,
      name,
      status: 'signed',
      createdAt,
      signedAt,
      signedFileUrl,
      folderPath,
      folderName,
      signers,
    });
  }

  return docs;
}

// ---------------------------------------------------------------------------
// 3. Title Normalization & Entity Extraction
// ---------------------------------------------------------------------------

const LEGAL_PREFIX_PATTERNS: RegExp[] = [
  /^contrato\s*[,;&+]*\s*procura[çc][aã]o\s*(?:e|\+|&|,)\s*declara[çc][oõ]es\b/i,
  /^procura[çc][aã]o\s*(?:e|\+|&|,)\s*declara[çc][oõ]es\b/i,
  /^contrato\s+de\s+presta[çc][aã]o\s+de\s+servi[çc]os(?:\s+advocat[ií]cios)?(?:\s+e\s+honor[aá]rios(?:\s+advocat[ií]cios)?)?\b/i,
  /^contrato\s+de\s+honor[aá]rios(?:\s+advocat[ií]cios)?\b/i,
  /^contrato\s+honor[aá]rios(?:\s+advocat[ií]cios)?\b/i,
  /^contrato\s+padr[aã]o\b/i,
  /^procura[çc][aã]o\s+ad\s+judicia(?:\s+et\s+extra)?\b/i,
  /^procura[çc][aã]o\s*(?:e|\+|&|,)\s*contrato\b/i,
  /^contrato\s*(?:e|\+|&|,)\s*procura[çc][aã]o\b/i,
  /^termo\s+de\s+ci[êe]ncia(?:\s+e\s+responsabilidade)?\b/i,
  /^declara[çc][aã]o\s+de\s+hipossufici[êe]ncia(?:\s+econ[ôo]mica)?\b/i,
  /^declara[çc][aã]o\s+de\s+justi[çc]a\s+gratuita\b/i,
  /^aditivo\s+(?:de\s+|ao\s+)?contrato(?:\s+de\s+honor[aá]rios)?\b/i,
  /^(?:processo|contrato|contratos|procura[çc][aã]o|procura[çc][oõ]es|declara[çc][oõ]es|declara[çc][aã]o|distrato|substabelecimento|assinatura|aditivo|aditamento|termo|honor[aá]rios)\b/i,
  // Strip dangling connectors when chaining prefixes (e.g. "Contrato de Honorários e Procuração - Nome")
  /^(?:e|de|da|do|das|dos)\s+(?=(?:contrato|procura[çc]|declara[çc]|termo|honor[aá]rio|presta[çc]|aditivo|distrato|substabelecimento|assinatura|hipossufici[êe]ncia|ci[êe]ncia|justi[çc]a))/i,
];

/**
 * Cleans ZapSign document titles by removing file extensions, copy counters,
 * CNJ process numbers, leading punctuation, and compound/chained legal prefixes/suffixes.
 */
export function cleanZapSignDocumentTitle(docName: string): string {
  let text = String(docName ?? '').trim();
  if (!text) return '';

  // Remove common file extensions (including repeated extensions like ".docx.pdf")
  text = text
    .replace(/(?:\.(?:docx|doc|pdf|odt|rtf|txt))+$/i, '')
    .trim();

  // Remove copy counters like " (1)", " (2)", " - cópia"
  text = text
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s*[-–—]\s*c[oó]pia(?:\s*\d*)?\s*$/i, '')
    .trim();

  // Remove CNJ process numbers (e.g. 0726687-33.2026.8.07.0020)
  text = text.replace(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g, ' ');

  // Iteratively strip leading separators and legal prefixes (chained combos supported)
  let changed = true;
  let guard = 0;
  while (changed && guard < 12) {
    changed = false;
    guard += 1;
    const before = text;
    text = text.replace(/^[\s,;:\-–—_|/+&]+/, '').trim();
    for (const pattern of LEGAL_PREFIX_PATTERNS) {
      text = text.replace(pattern, '').trim();
    }
    text = text.replace(/^[\s,;:\-–—_|/+&]+/, '').trim();
    if (text !== before) changed = true;
  }

  // Strip trailing suffixes like "- Assinatura", "- Assinado", "- Divórcio", "_CURATELA"
  let suffixChanged = true;
  let suffixGuard = 0;
  while (suffixChanged && suffixGuard < 4) {
    suffixChanged = false;
    suffixGuard += 1;
    const before = text;
    text = text
      .replace(
        /\s*[-–—_|/]\s*(assinatura|assinado|assinada|final|c[oó]pia|ads\s*fam[ií]lia)\s*$/i,
        ''
      )
      .replace(
        /\s*[-–—_|/]\s*(interdi[çc][aã]o[_\s/]*curatela|div[oó]rcio|pens[aã]o|alimentos|guarda|invent[aá]rio|curatela|interdi[çc][aã]o|fam[ií]lia|uniao\s*estavel|uni[aã]o\s*est[aá]vel)\s*$/i,
        ''
      )
      .replace(/\s*\(\d+\)\s*$/g, '')
      .replace(/[\s,;:\-–—_|/+]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (text !== before) suffixChanged = true;
  }

  // Discard if remaining tokens are exclusively legal noise words or numbers
  const remainingTokens = normalizePersonTokens(text).filter(
    (t) => !GENERIC_NON_NAME_WORDS.has(t) && !/^\d+$/.test(t)
  );
  if (remainingTokens.length === 0) {
    return '';
  }

  return text;
}

/**
 * Splits a cleaned document title containing multiple individuals separated by "," or " e "
 * (e.g. "Rainara, Rayla e Luiz Felipe" -> ["Rainara", "Rayla", "Luiz Felipe"]).
 */
export function extractIndividualNamesFromTitle(docName: string): string[] {
  const cleaned = cleanZapSignDocumentTitle(docName);
  if (!cleaned) return [];

  const rawParts = cleaned
    .split(/\s*(?:,|;|&|\/|\+|–|—)\s*|\s+e\s+/i)
    .map((part) => part.replace(/^[\s\-–—_]+|[\s\-–—_]+$/g, '').trim())
    .filter(Boolean);

  const results: string[] = [];
  const seen = new Set<string>();

  const pushIfPersonLike = (candidate: string) => {
    const tokens = normalizePersonTokens(candidate).filter(
      (t) => !GENERIC_NON_NAME_WORDS.has(t) && !/^\d+$/.test(t)
    );
    if (tokens.length === 0) return;
    if (isFirmSignerName(candidate)) return;
    const key = tokens.join(' ');
    if (!seen.has(key)) {
      seen.add(key);
      results.push(candidate);
    }
  };

  for (const part of rawParts) {
    pushIfPersonLike(part);
  }

  if (rawParts.length === 1) {
    pushIfPersonLike(cleaned);
  }

  return results;
}

/**
 * Structured title normalization helper returning raw title, normalized title,
 * split candidate names, and procedural flag.
 */
export function normalizeZapSignTitle(docName: string): ZapSignNormalizedTitle {
  const rawTitle = String(docName ?? '').trim();
  const normalizedTitle = cleanZapSignDocumentTitle(rawTitle);
  const extractedNames = extractIndividualNamesFromTitle(rawTitle);
  return {
    rawTitle,
    normalizedTitle,
    extractedNames,
    isProcedural: isProceduralDocumentTitle(rawTitle),
  };
}

/**
 * Strips common Barreto Drive folder prefixes/codes and trailing case-area descriptors
 * (e.g. "BA-048 - Maria Silva - Divórcio" -> "Maria Silva", "01. João Souza (Guarda)" -> "João Souza").
 */
export function stripDriveFolderDecorators(folderName: string): string {
  return String(folderName ?? '')
    .trim()
    // Strip alphanumeric case codes like "BA-048 - ", "CLI_12 - ", "048 - ", "01. "
    .replace(
      /^(?:[a-z]{1,5}\s*[-–_.]?\s*\d{1,5}|\d{1,5})\s*[-–—._|:]\s*/i,
      ''
    )
    // Strip parenthetical tags like "(Família)", "(Ads)", "(Encerrado)"
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    // Strip trailing legal area/action descriptors separated by dash/pipe/underscore
    .replace(
      /\s*[-–—_|/]\s*(div[oó]rcio|pens[aã]o|guarda|alimentos|invent[aá]rio|fam[ií]lia|regulamenta[çc][aã]o|uni[aã]o|curatela|interdi[çc][aã]o|partilha|execu[çc][aã]o|revisional|exonera[çc][aã]o|paternidade|ads|c[ií]vel|trabalhista).*$/i,
      ''
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function isFirmSignerName(name: string, email?: string): boolean {
  const norm = normalizeText(name);
  const normEmail = normalizeText(email ?? '');

  if (
    normEmail.includes('barretoadvocacia') ||
    normEmail.includes('barreto.adv')
  ) {
    return true;
  }

  if (!norm) return false;

  return (
    norm.includes('barreto advocacia') ||
    norm === 'barreto' ||
    norm.includes('escritorio barreto') ||
    norm.includes('paulo barreto') ||
    norm.includes('paulo henrique barreto') ||
    norm.includes('dr paulo barreto') ||
    norm.includes('advocacia barreto')
  );
}

export function isClientClosedOrCanceled(client: ClientCase): boolean {
  if (isExcludedAuditFolder(client.rawDriveStage ?? client.driveStage)) {
    return true;
  }
  const notesNorm = normalizeText(client.notes ?? '');
  return notesNorm.includes('encerrad') || notesNorm.includes('cancelad');
}

// ---------------------------------------------------------------------------
// 4. Deterministic Name Tokenization & Phonetic Similarity
// ---------------------------------------------------------------------------

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
 * (e.g. "Kennúbia" <-> "Kennúbya", "Anna" <-> "Ana", "Thiago" <-> "Tiago",
 * "Philipe" <-> "Filipe", "Helena" <-> "Elena", "Luiz" <-> "Luis", "Souza" <-> "Sousa").
 */
export function phoneticNormalizeToken(token: string): string {
  return token
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^h(?=[aeiouy])/g, '')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/y/g, 'i')
    .replace(/w/g, 'v')
    .replace(/k/g, 'c')
    .replace(/qu/g, 'c')
    .replace(/ç/g, 's')
    .replace(/z/g, 's')
    .replace(/ge/g, 'je')
    .replace(/gi/g, 'ji')
    .replace(/([a-z])\1+/g, '$1')
    .trim();
}

function damerauLevenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}

function tokensEqualWithTolerance(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  const pa = phoneticNormalizeToken(a);
  const pb = phoneticNormalizeToken(b);
  if (pa === pb) return true;

  // Bounded typo tolerance (1 edit / adjacent transposition) while preventing gender-pair collisions like Maria/Mario
  const minLen = Math.min(pa.length, pb.length);
  if (minLen >= 6 && pa[0] === pb[0] && damerauLevenshteinDistance(pa, pb) <= 1) {
    return true;
  }
  if (
    minLen === 5 &&
    pa[0] === pb[0] &&
    pa[pa.length - 1] === pb[pb.length - 1] &&
    damerauLevenshteinDistance(pa, pb) <= 1
  ) {
    return true;
  }
  return false;
}

export interface NameMatchDetail {
  matched: boolean;
  score: number;
  reason: string;
  isCoHolderSingleName?: boolean;
}

/**
 * Evaluates name similarity deterministically with score and human-readable reason.
 * Supports single distinctive first-name matching ONLY when explicitly enabled
 * (for split co-holders extracted from multi-person titles like "Rainara, Rayla e Luiz Felipe").
 */
export function evaluateNameMatch(
  nameA: string,
  nameB: string,
  options?: { allowDistinctiveSingleName?: boolean }
): NameMatchDetail {
  const tokensA = normalizePersonTokens(nameA).filter(
    (t) => !GENERIC_NON_NAME_WORDS.has(t)
  );
  const tokensB = normalizePersonTokens(nameB).filter(
    (t) => !GENERIC_NON_NAME_WORDS.has(t)
  );
  if (tokensA.length === 0 || tokensB.length === 0) {
    return { matched: false, score: 0, reason: '' };
  }

  const fullA = tokensA.join(' ');
  const fullB = tokensB.join(' ');

  // 1. Exact preposition-stripped match
  if (fullA === fullB) {
    return { matched: true, score: 95, reason: 'Nome completo idêntico' };
  }

  // 2. Phonetic full match (e.g. Kennúbia vs Kennúbya)
  if (
    tokensA.length >= 2 &&
    tokensB.length >= 2 &&
    phoneticNormalizeToken(tokensA.join('')) ===
      phoneticNormalizeToken(tokensB.join(''))
  ) {
    return {
      matched: true,
      score: 92,
      reason: 'Nome completo compatível (variação ortográfica)',
    };
  }

  // 3. Clean containment when the shorter side has at least 2 tokens
  const minTokensCount = Math.min(tokensA.length, tokensB.length);
  if (minTokensCount >= 2 && (fullA.includes(fullB) || fullB.includes(fullA))) {
    return {
      matched: true,
      score: 90,
      reason: 'Nome compatível (contido integralmente)',
    };
  }

  // 4. First name + last surname match (exact or phonetic)
  if (tokensA.length >= 2 && tokensB.length >= 2) {
    const firstMatch = tokensEqualWithTolerance(tokensA[0], tokensB[0]);
    const lastMatch = tokensEqualWithTolerance(
      tokensA[tokensA.length - 1],
      tokensB[tokensB.length - 1]
    );
    if (firstMatch && lastMatch) {
      return {
        matched: true,
        score: 88,
        reason: 'Primeiro nome e último sobrenome compatíveis',
      };
    }
  }

  // 5. Multi-token overlap (>= 2 matching tokens with at least 1 distinctive token)
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
      return {
        matched: true,
        score: 82,
        reason: 'Múltiplos termos do nome em comum',
      };
    }

    // 5b. Abbreviated first-name initial + >= 2 matching surnames (e.g. "M. Souza Almeida" <-> "Mariana Souza Almeida")
    const firstInitialMatch =
      (tokensA[0].length === 1 && tokensB[0].startsWith(tokensA[0])) ||
      (tokensB[0].length === 1 && tokensA[0].startsWith(tokensB[0]));
    if (firstInitialMatch && matchedTokens.length >= 2) {
      return {
        matched: true,
        score: 80,
        reason: 'Inicial do primeiro nome e sobrenomes compatíveis',
      };
    }
  }

  // 6. Distinctive first-name match for split multi-person co-holders (e.g. "Rainara" -> "Rainara Oliveira Santos")
  if (options?.allowDistinctiveSingleName) {
    const singleSide =
      tokensA.length === 1 && tokensB.length >= 2
        ? { single: tokensA[0], multi: tokensB }
        : tokensB.length === 1 && tokensA.length >= 2
          ? { single: tokensB[0], multi: tokensA }
          : null;

    if (
      singleSide &&
      singleSide.single.length >= 5 &&
      !COMMON_SURNAME_TOKENS.has(singleSide.single) &&
      tokensEqualWithTolerance(singleSide.single, singleSide.multi[0])
    ) {
      return {
        matched: true,
        score: 76,
        reason: `Co-titular identificado pelo primeiro nome (${singleSide.single})`,
        isCoHolderSingleName: true,
      };
    }
  }

  return { matched: false, score: 0, reason: '' };
}

export function isNameMatch(nameA: string, nameB: string): boolean {
  return evaluateNameMatch(nameA, nameB).matched;
}

export function getClientSigners(doc: ZapSignSignedDoc): ZapSignSigner[] {
  const signers = Array.isArray(doc?.signers) ? doc.signers : [];
  return signers.filter(
    (s) =>
      Boolean(s && typeof s.name === 'string') &&
      s.name.trim().length > 0 &&
      !isFirmSignerName(s.name, s.email)
  );
}

export function extractPrimarySignerName(doc: ZapSignSignedDoc): string {
  const clientSigners = getClientSigners(doc);
  if (clientSigners.length > 0) {
    return clientSigners[0].name.trim();
  }

  const titleInfo = normalizeZapSignTitle(doc.name);
  if (titleInfo.extractedNames.length > 0) {
    return titleInfo.extractedNames.join(', ');
  }

  if (titleInfo.normalizedTitle) return titleInfo.normalizedTitle;

  const firstSigner = doc.signers[0]?.name?.trim();
  if (firstSigner && !isFirmSignerName(firstSigner, doc.signers[0]?.email)) {
    return firstSigner;
  }

  return doc.name;
}

// ---------------------------------------------------------------------------
// 5. Cross-Source Matchers (Sheets, Drive, Calendar)
// ---------------------------------------------------------------------------

interface CandidateNameEntry {
  name: string;
  source: 'signer' | 'title_split' | 'title_clean';
  allowSingleName: boolean;
}

function getCandidateNameEntries(
  doc: ZapSignSignedDoc,
  titleInfo: ZapSignNormalizedTitle
): CandidateNameEntry[] {
  const seen = new Set<string>();
  const ordered: CandidateNameEntry[] = [];

  const pushUnique = (
    val: string | undefined,
    source: CandidateNameEntry['source'],
    allowSingleName: boolean
  ) => {
    const trimmed = (val ?? '').trim();
    if (!trimmed || isFirmSignerName(trimmed)) return;
    const key = normalizeText(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push({ name: trimmed, source, allowSingleName });
  };

  // 1. Prioritize non-firm signers from ZapSign API
  for (const s of getClientSigners(doc)) {
    pushUnique(s.name, 'signer', false);
  }

  // 2. Individual co-holders extracted from cleaned document title
  const isMultiHolderTitle = titleInfo.extractedNames.length >= 2;
  for (const individual of titleInfo.extractedNames) {
    pushUnique(individual, 'title_split', isMultiHolderTitle);
  }

  // 3. Full normalized title
  pushUnique(titleInfo.normalizedTitle, 'title_clean', false);

  return ordered;
}

function buildExtractedProfile(
  doc: ZapSignSignedDoc,
  primarySignerName: string,
  candidates: CandidateNameEntry[]
): ZapSignExtractedProfile {
  const clientSigners = getClientSigners(doc);
  const primarySigner = clientSigners[0];
  const cpf =
    clientSigners.map((s) => s.cpf).find((v): v is string => Boolean(v)) ??
    undefined;
  const phone =
    clientSigners.map((s) => s.phone).find((v): v is string => Boolean(v)) ??
    undefined;
  const email =
    clientSigners.map((s) => s.email).find((v): v is string => Boolean(v)) ??
    undefined;

  return {
    cleanName: primarySigner?.name?.trim() || primarySignerName,
    candidateNames: candidates.map((c) => c.name),
    cpf,
    phone,
    email,
    signedAt: doc.signedAt,
  };
}

interface ClientSheetMatch {
  client: ClientCase;
  score: number;
  criteria: 'cpf' | 'phone' | 'name' | 'co_holder';
  reason: string;
}

function matchDocToSheetClients(
  doc: ZapSignSignedDoc,
  candidates: CandidateNameEntry[],
  clients: ClientCase[]
): ClientSheetMatch[] {
  if (!Array.isArray(clients) || clients.length === 0) return [];
  const clientSigners = getClientSigners(doc);
  const signerCpfs = clientSigners
    .map((s) => normalizeCPF(s.cpf))
    .filter((v): v is string => Boolean(v));
  const signerPhones = clientSigners
    .map((s) => s.phone)
    .filter((v): v is string => Boolean(v));
  const signerEmails = clientSigners
    .map((s) => String(s.email ?? '').trim().toLowerCase())
    .filter((e) => e.includes('@') && !isFirmSignerName('', e));

  const matches: ClientSheetMatch[] = [];

  for (const client of clients) {
    if (!client || !client.fullName) continue;
    let bestScore = 0;
    let bestReason = '';
    let bestCriteria: ClientSheetMatch['criteria'] = 'name';

    // 1. Exact normalized CPF match
    const clientCpf = extractClientCPF(client);
    if (clientCpf && signerCpfs.includes(clientCpf)) {
      bestScore = 100;
      bestCriteria = 'cpf';
      bestReason = 'CPF idêntico na planilha';
    }

    // 2. Exact signer email match in client notes
    if (bestScore < 97 && signerEmails.length > 0 && client.notes) {
      const notesLower = client.notes.toLowerCase();
      if (signerEmails.some((email) => notesLower.includes(email))) {
        bestScore = 97;
        bestCriteria = 'name';
        bestReason = 'E-mail do signatário encontrado nas notas da planilha';
      }
    }

    // 3. Exact normalized phone match
    if (bestScore < 96 && client.phone) {
      const matchedPhone = signerPhones.some((sp) =>
        phonesMatch(sp, client.phone)
      );
      if (matchedPhone) {
        bestScore = 96;
        bestCriteria = 'phone';
        bestReason = 'Telefone idêntico na planilha';
      }
    }

    // 4. Smart name matching across signers and cleaned/split title candidates
    for (const candidate of candidates) {
      const detail = evaluateNameMatch(client.fullName, candidate.name, {
        allowDistinctiveSingleName: candidate.allowSingleName,
      });
      if (detail.matched && detail.score > bestScore) {
        bestScore = detail.score;
        bestCriteria = detail.isCoHolderSingleName ? 'co_holder' : 'name';
        bestReason =
          candidate.source === 'signer'
            ? `${detail.reason} (signatário ZapSign)`
            : `${detail.reason} (título limpo)`;
      }
    }

    if (bestScore > 0) {
      matches.push({
        client,
        score: bestScore,
        criteria: bestCriteria,
        reason: bestReason,
      });
    }
  }

  // Ambiguity safeguard: if multiple distinct clients match ONLY via single-name co-holder heuristic
  // without a higher-confidence match, avoid linking blindly to the wrong person.
  const strongMatches = matches.filter((m) => m.criteria !== 'co_holder');
  if (strongMatches.length === 0 && matches.length > 1) {
    return [];
  }

  return matches.sort((a, b) => b.score - a.score);
}

interface DriveMatchDetail {
  folder: ZapSignDriveFolderInfo;
  score: number;
  reason: string;
  exclusionCheck: FolderExclusionMatch;
}

function findMatchingDriveFolder(
  candidates: CandidateNameEntry[],
  driveEtapas: AppsScriptDriveEtapaRow[],
  extraClientName?: string
): DriveMatchDetail | undefined {
  if (!driveEtapas || driveEtapas.length === 0) return undefined;

  const searchList: CandidateNameEntry[] = [...candidates];
  if (extraClientName) {
    searchList.unshift({
      name: extraClientName,
      source: 'signer',
      allowSingleName: false,
    });
  }

  let best: DriveMatchDetail | undefined;

  for (const folder of driveEtapas) {
    const nomePasta = String(folder.nomePasta ?? '').trim();
    if (!nomePasta) continue;
    const strippedPasta = stripDriveFolderDecorators(nomePasta);
    // Support Drive folders containing multiple co-holders (e.g. "BA-051 - Rainara e Rayla")
    const folderNameVariants = [
      strippedPasta,
      nomePasta,
      ...strippedPasta
        .split(/\s*(?:,|;|&|\/|\+)\s*|\s+e\s+/i)
        .map((p) => p.trim())
        .filter((p) => p.length >= 4 && p !== strippedPasta),
    ];

    const etapa = String(folder.etapa ?? '').trim() || 'Drive';
    const urlPasta =
      String(folder.urlPasta ?? '').trim() ||
      'https://drive.google.com/drive/my-drive';

    for (const candidate of searchList) {
      let bestLocal: NameMatchDetail = { matched: false, score: 0, reason: '' };
      for (const variant of folderNameVariants) {
        const evalResult = evaluateNameMatch(candidate.name, variant, {
          allowDistinctiveSingleName: candidate.allowSingleName,
        });
        if (evalResult.matched && evalResult.score > bestLocal.score) {
          bestLocal = evalResult;
        }
      }

      if (bestLocal.matched && (!best || bestLocal.score > best.score)) {
        const exclusionCheck = checkExcludedZapSignFolder(etapa, etapa);
        const isClosed =
          isClosedDriveStage(etapa) || exclusionCheck.isClosedArchive;
        const isExcluded = isClosed || exclusionCheck.isExcluded;
        best = {
          folder: {
            etapa,
            nomePasta,
            urlPasta,
            isClosed,
            isExcludedFolder: isExcluded,
          },
          score: bestLocal.score,
          reason: `Pasta no Drive "${nomePasta}" (${bestLocal.reason})`,
          exclusionCheck,
        };
      }
    }
  }

  return best;
}

interface CalendarMatchDetail {
  info: ZapSignCalendarMatchInfo;
  reason: string;
}

function findMatchingCalendarEvents(
  doc: ZapSignSignedDoc,
  candidates: CandidateNameEntry[],
  calendarEvents: AppsScriptCalendarEventRow[],
  extraClient?: ClientCase
): CalendarMatchDetail | undefined {
  if (!Array.isArray(calendarEvents) || calendarEvents.length === 0) {
    return undefined;
  }

  const searchList: CandidateNameEntry[] = [...candidates];
  if (extraClient?.fullName) {
    searchList.unshift({
      name: extraClient.fullName,
      source: 'signer',
      allowSingleName: false,
    });
  }

  const clientSigners = getClientSigners(doc);
  const signerCpfs = [
    ...clientSigners
      .map((s) => normalizeCPF(s.cpf))
      .filter((v): v is string => Boolean(v)),
    ...(extraClient ? [extractClientCPF(extraClient)].filter((v): v is string => Boolean(v)) : []),
  ];
  const signerPhones = [
    ...clientSigners
      .map((s) => s.phone)
      .filter((v): v is string => Boolean(v)),
    ...(extraClient?.phone ? [extraClient.phone] : []),
  ];
  const signerEmails = clientSigners
    .map((s) => String(s.email ?? '').trim().toLowerCase())
    .filter((e) => e.includes('@') && !isFirmSignerName('', e));

  const matchedEvents: AppsScriptCalendarEventRow[] = [];
  let matchedByIdentifier = false;

  for (const ev of calendarEvents) {
    if (!ev) continue;
    const titulo = String(ev.titulo ?? '').trim();
    const descricao = String(ev.descricao ?? '').trim();
    const combined = `${titulo} ${descricao}`.trim();
    if (!combined) continue;

    // 1. Check CPF, email, or phone directly inside event description/title
    const eventCpf = extractCPFInText(combined);
    if (eventCpf && signerCpfs.includes(eventCpf)) {
      matchedEvents.push(ev);
      matchedByIdentifier = true;
      continue;
    }

    const combinedLower = combined.toLowerCase();
    if (
      signerEmails.length > 0 &&
      signerEmails.some((email) => combinedLower.includes(email))
    ) {
      matchedEvents.push(ev);
      matchedByIdentifier = true;
      continue;
    }

    const phoneMatchesInText = combined.match(
      /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-.\s]?\d{4}/g
    );
    if (
      phoneMatchesInText &&
      signerPhones.some((sp) =>
        phoneMatchesInText.some((candidatePhone) =>
          phonesMatch(sp, candidatePhone)
        )
      )
    ) {
      matchedEvents.push(ev);
      matchedByIdentifier = true;
      continue;
    }

    // 2. Clean common Calendar billing prefixes like "Cobrança Honorários — Nome"
    const strippedTitle = titulo
      .replace(
        /^(?:cobran[çc]a(?:\s+de)?\s+honor[aá]rios|cobran[çc]a|honor[aá]rios|vencimento|parcela)\s*[-–—:|]*\s*/i,
        ''
      )
      .trim();

    const combinedTokens = normalizePersonTokens(combined);
    const normCombined = combinedTokens.join(' ');

    const isHit = searchList.some((candidate) => {
      if (
        evaluateNameMatch(candidate.name, strippedTitle, {
          allowDistinctiveSingleName: candidate.allowSingleName,
        }).matched
      ) {
        return true;
      }

      const candTokens = normalizePersonTokens(candidate.name).filter(
        (t) => !GENERIC_NON_NAME_WORDS.has(t)
      );
      if (candTokens.length >= 2) {
        const candFull = candTokens.join(' ');
        if (normCombined.includes(candFull)) return true;
        const firstHit = combinedTokens.some((t) =>
          tokensEqualWithTolerance(t, candTokens[0])
        );
        const lastHit = combinedTokens.some((t) =>
          tokensEqualWithTolerance(t, candTokens[candTokens.length - 1])
        );
        if (firstHit && lastHit) return true;
      } else if (
        candidate.allowSingleName &&
        candTokens.length === 1 &&
        candTokens[0].length >= 5 &&
        !COMMON_SURNAME_TOKENS.has(candTokens[0])
      ) {
        if (
          combinedTokens.some((t) =>
            tokensEqualWithTolerance(t, candTokens[0])
          )
        ) {
          return true;
        }
      }

      return false;
    });

    if (isHit) {
      matchedEvents.push(ev);
    }
  }

  if (matchedEvents.length === 0) return undefined;

  const sorted = [...matchedEvents].sort((a, b) =>
    String(b.inicio ?? '').localeCompare(String(a.inicio ?? ''))
  );
  const latest = sorted[0];

  const info: ZapSignCalendarMatchInfo = {
    eventCount: matchedEvents.length,
    latestEventTitle: String(latest.titulo ?? 'Evento de cobrança').trim(),
    latestEventDate: String(latest.inicio ?? '').trim() || undefined,
    eventIds: matchedEvents
      .map((e, idx) => String(e.id ?? `cal-${idx}`))
      .filter(Boolean),
  };

  return {
    info,
    reason: matchedByIdentifier
      ? `Evento no Calendar via CPF/telefone (${info.eventCount} registro${info.eventCount > 1 ? 's' : ''})`
      : `Evento no Calendar (${info.eventCount} registro${info.eventCount > 1 ? 's' : ''})`,
  };
}

// ---------------------------------------------------------------------------
// 6. Per-Document Diagnostic & Full Cross-Source Reconciliation Engine
// ---------------------------------------------------------------------------

interface DocumentReconciliationOutput {
  item: ZapSignCrossReferenceItem;
  diagnostic: ZapSignDocumentDiagnostic;
  sheetMatches: ClientSheetMatch[];
}

function buildDiagnosticObject(params: {
  doc: ZapSignSignedDoc;
  titleInfo: ZapSignNormalizedTitle;
  primarySignerName: string;
  extractedProfile: ZapSignExtractedProfile;
  clientSignersCount: number;
  ignoredFirmSignersCount: number;
  folderExclusion: ZapSignFolderExclusionDiagnostic;
  primarySheetMatch?: ClientSheetMatch;
  driveFolder?: ZapSignDriveFolderInfo;
  driveMatch?: DriveMatchDetail;
  calendarDetail?: CalendarMatchDetail;
  matchedSources: ZapSignSourceName[];
  auditStatus: ZapSignAuditStatus;
  linkageStatus: ZapSignLinkageStatus;
  matchScore: number;
  matchReason: string;
}): ZapSignDocumentDiagnostic {
  const {
    doc,
    titleInfo,
    primarySignerName,
    extractedProfile,
    clientSignersCount,
    ignoredFirmSignersCount,
    folderExclusion,
    primarySheetMatch,
    driveFolder,
    driveMatch,
    calendarDetail,
    matchedSources,
    auditStatus,
    linkageStatus,
    matchScore,
    matchReason,
  } = params;

  return {
    token: doc.token,
    rawTitle: titleInfo.rawTitle,
    normalizedTitle: titleInfo.normalizedTitle,
    extractedNames: titleInfo.extractedNames,
    primarySignerName,
    isProceduralTitle: titleInfo.isProcedural,
    folderExclusion,
    sources: {
      zapsign: {
        signedAt: doc.signedAt,
        folderPath: doc.folderPath,
        folderName: doc.folderName,
        clientSignersCount,
        ignoredFirmSignersCount,
        cpf: extractedProfile.cpf,
        phone: extractedProfile.phone,
        email: extractedProfile.email,
      },
      sheets: {
        matched: Boolean(primarySheetMatch),
        clientId: primarySheetMatch?.client.id,
        clientName: primarySheetMatch?.client.fullName,
        score: primarySheetMatch?.score ?? 0,
        matchCriteria: primarySheetMatch?.criteria ?? null,
        reason: primarySheetMatch?.reason,
      },
      drive: {
        matched: Boolean(driveFolder),
        etapa: driveFolder?.etapa,
        folderName: driveFolder?.nomePasta,
        folderUrl: driveFolder?.urlPasta,
        score: driveMatch?.score ?? (driveFolder ? 85 : 0),
        isExcludedFolder: Boolean(driveFolder?.isExcludedFolder),
        reason:
          driveMatch?.reason ??
          (driveFolder
            ? `Pasta Drive vinculada ao cliente (${driveFolder.etapa})`
            : undefined),
      },
      calendar: {
        matched: Boolean(calendarDetail),
        eventCount: calendarDetail?.info.eventCount ?? 0,
        latestEventTitle: calendarDetail?.info.latestEventTitle,
        latestEventDate: calendarDetail?.info.latestEventDate,
        eventIds: calendarDetail?.info.eventIds ?? [],
        reason: calendarDetail?.reason,
      },
    },
    matchedSources,
    auditStatus,
    linkageStatus,
    matchScore,
    matchReason,
  };
}

function reconcileSingleDocument(
  doc: ZapSignSignedDoc,
  clients: ClientCase[],
  driveEtapas: AppsScriptDriveEtapaRow[],
  calendarEvents: AppsScriptCalendarEventRow[]
): DocumentReconciliationOutput {
  const rawSignersCount = Array.isArray(doc.signers) ? doc.signers.length : 0;
  const titleInfo = normalizeZapSignTitle(doc.name);
  const clientSigners = getClientSigners(doc);
  const ignoredFirmSignersCount = Math.max(
    0,
    rawSignersCount - clientSigners.length
  );
  const primarySignerName = extractPrimarySignerName(doc);
  const candidates = getCandidateNameEntries(doc, titleInfo);
  const extractedProfile = buildExtractedProfile(
    doc,
    primarySignerName,
    candidates
  );

  // 1. Rigid ZapSign folder exclusion first ('ZZ - Encerrados', 'Docs Faltavam', 'Fechados do Escritório')
  const zapFolderCheck = checkExcludedZapSignFolder(
    doc.folderPath,
    doc.folderName
  );
  if (zapFolderCheck.isExcluded) {
    const folderLabel =
      zapFolderCheck.folderLabel ||
      doc.folderName ||
      doc.folderPath ||
      zapFolderCheck.matchedRule ||
      'Pasta ignorada';
    const auditStatus: ZapSignAuditStatus = zapFolderCheck.isClosedArchive
      ? 'closed_archive'
      : 'excluded_folder';
    const matchReason = `Ignorado pela pasta do ZapSign (${zapFolderCheck.matchedRule ?? folderLabel})`;
    const folderExclusion: ZapSignFolderExclusionDiagnostic = {
      excluded: true,
      source: 'zapsign',
      matchedRule: zapFolderCheck.matchedRule,
      folderLabel,
      isClosedArchive: zapFolderCheck.isClosedArchive,
    };

    const diagnostic = buildDiagnosticObject({
      doc,
      titleInfo,
      primarySignerName,
      extractedProfile,
      clientSignersCount: clientSigners.length,
      ignoredFirmSignersCount,
      folderExclusion,
      matchedSources: [],
      auditStatus,
      linkageStatus: 'pendente_cadastro',
      matchScore: 0,
      matchReason,
    });

    const item: ZapSignCrossReferenceItem = {
      doc,
      primarySignerName,
      auditStatus,
      linkageStatus: 'pendente_cadastro',
      matchedSources: [],
      matchScore: 0,
      matchReason,
      inSpreadsheet: false,
      extractedProfile,
      diagnostic,
    };

    return { item, diagnostic, sheetMatches: [] };
  }

  // 2. Match against Google Sheets (`clients`)
  let sheetMatches = matchDocToSheetClients(doc, candidates, clients);
  let primarySheetMatch = sheetMatches[0];
  let primaryMatchedClient = primarySheetMatch?.client;

  // 3. Match against Google Drive (`driveEtapas`)
  const driveMatch = findMatchingDriveFolder(
    candidates,
    driveEtapas,
    primaryMatchedClient?.fullName
  );
  let driveFolder = driveMatch?.folder;

  // 3b. Transitive Drive-assisted Sheets reconciliation:
  // If ZapSign didn't match Sheets directly, but matched a non-excluded Drive folder with high confidence,
  // cross-check the cleaned Drive folder name against Sheets (requiring strong full-name match >= 88).
  if (
    sheetMatches.length === 0 &&
    driveMatch &&
    driveMatch.score >= 82 &&
    !driveMatch.folder.isExcludedFolder
  ) {
    const driveCleanName = stripDriveFolderDecorators(driveMatch.folder.nomePasta);
    if (driveCleanName) {
      const assistedMatches = matchDocToSheetClients(
        doc,
        [{ name: driveCleanName, source: 'signer', allowSingleName: false }],
        clients
      ).filter((m) => m.score >= 88);

      if (assistedMatches.length === 1) {
        sheetMatches = [
          {
            ...assistedMatches[0],
            score: Math.min(assistedMatches[0].score, driveMatch.score),
            reason: `${assistedMatches[0].reason} (coligado via pasta Drive "${driveMatch.folder.nomePasta}")`,
          },
        ];
        primarySheetMatch = sheetMatches[0];
        primaryMatchedClient = primarySheetMatch.client;
      }
    }
  }

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
      isExcludedFolder: isExcludedAuditFolder(etapa),
    };
  }

  // 4. Match against Google Calendar (`calendarEvents`) using ZapSign + reconciled Sheets client info
  const calendarDetail = findMatchingCalendarEvents(
    doc,
    candidates,
    calendarEvents,
    primaryMatchedClient
  );
  const calendarMatch = calendarDetail?.info;

  const matchedSources: ZapSignSourceName[] = [];
  if (sheetMatches.length > 0) matchedSources.push('Sheets');
  if (driveFolder) matchedSources.push('Drive');
  if (calendarMatch) matchedSources.push('Calendar');

  // 5. Check Drive / Client rigid excluded or closed archive status
  const isDriveExcluded = Boolean(driveFolder?.isExcludedFolder);
  const isClosedClient = sheetMatches.some((m) =>
    isClientClosedOrCanceled(m.client)
  );
  const isClosed = Boolean(driveFolder?.isClosed) || isClosedClient;

  if (isClosed || isDriveExcluded) {
    const auditStatus: ZapSignAuditStatus = isClosed
      ? 'closed_archive'
      : 'excluded_folder';
    const linkageStatus: ZapSignLinkageStatus =
      sheetMatches.length > 0
        ? 'vinculado_planilha'
        : matchedSources.length > 0
          ? 'vinculado_drive_ou_agenda_sem_planilha'
          : 'pendente_cadastro';
    const matchScore = primarySheetMatch?.score ?? driveMatch?.score ?? 0;
    const matchReason = driveFolder
      ? `Ignorado pela pasta (${driveFolder.etapa})`
      : 'Cliente encerrado/cancelado';

    const driveRuleCheck = driveFolder
      ? checkExcludedZapSignFolder(driveFolder.etapa, driveFolder.etapa)
      : undefined;

    const folderExclusion: ZapSignFolderExclusionDiagnostic = {
      excluded: true,
      source: driveFolder && isDriveExcluded ? 'drive' : 'client',
      matchedRule:
        driveRuleCheck?.matchedRule ??
        (isClosed ? 'ZZ - Encerrados' : undefined),
      folderLabel: driveFolder?.etapa ?? primaryMatchedClient?.driveStage,
      isClosedArchive: isClosed,
    };

    const diagnostic = buildDiagnosticObject({
      doc,
      titleInfo,
      primarySignerName,
      extractedProfile,
      clientSignersCount: clientSigners.length,
      ignoredFirmSignersCount,
      folderExclusion,
      primarySheetMatch,
      driveFolder,
      driveMatch,
      calendarDetail,
      matchedSources,
      auditStatus,
      linkageStatus,
      matchScore,
      matchReason,
    });

    const item: ZapSignCrossReferenceItem = {
      doc,
      primarySignerName,
      auditStatus,
      linkageStatus,
      matchedSources,
      matchedClientId: primaryMatchedClient?.id,
      matchedClientName: primaryMatchedClient?.fullName,
      matchScore,
      matchReason,
      inSpreadsheet: sheetMatches.length > 0,
      matchedClient: primaryMatchedClient,
      driveFolder,
      calendarMatch,
      extractedProfile,
      diagnostic,
    };

    return { item, diagnostic, sheetMatches };
  }

  const noExclusion: ZapSignFolderExclusionDiagnostic = {
    excluded: false,
    source: null,
    isClosedArchive: false,
  };

  // 6. Matched in Sheets -> reconciled!
  if (sheetMatches.length > 0 && primarySheetMatch) {
    const reasons = [primarySheetMatch.reason];
    if (driveFolder) reasons.push(`Drive: ${driveFolder.etapa}`);
    if (calendarMatch) {
      reasons.push(`Calendar: ${calendarMatch.eventCount} evento(s)`);
    }
    const matchReason = reasons.join(' · ');

    const diagnostic = buildDiagnosticObject({
      doc,
      titleInfo,
      primarySignerName,
      extractedProfile,
      clientSignersCount: clientSigners.length,
      ignoredFirmSignersCount,
      folderExclusion: noExclusion,
      primarySheetMatch,
      driveFolder,
      driveMatch,
      calendarDetail,
      matchedSources,
      auditStatus: 'matched_spreadsheet',
      linkageStatus: 'vinculado_planilha',
      matchScore: primarySheetMatch.score,
      matchReason,
    });

    const item: ZapSignCrossReferenceItem = {
      doc,
      primarySignerName,
      auditStatus: 'matched_spreadsheet',
      linkageStatus: 'vinculado_planilha',
      matchedSources,
      matchedClientId: primarySheetMatch.client.id,
      matchedClientName: primarySheetMatch.client.fullName,
      matchScore: primarySheetMatch.score,
      matchReason,
      inSpreadsheet: true,
      matchedClient: primarySheetMatch.client,
      driveFolder,
      calendarMatch,
      extractedProfile,
      diagnostic,
    };

    return { item, diagnostic, sheetMatches };
  }

  // 7. Procedural non-contract document (starts with "PROCESSO " or "PROCESSO_") with no financial contract match
  if (titleInfo.isProcedural) {
    const procReasons = [
      'Documento processual sem contrato financeiro vinculado',
    ];
    if (driveFolder) procReasons.push(`Drive: ${driveFolder.etapa}`);
    if (calendarMatch) {
      procReasons.push(`Calendar: ${calendarMatch.eventCount} evento(s)`);
    }
    const linkageStatus: ZapSignLinkageStatus =
      driveFolder || calendarMatch
        ? 'vinculado_drive_ou_agenda_sem_planilha'
        : 'pendente_cadastro';
    const matchScore = driveMatch?.score ?? (calendarMatch ? 70 : 0);
    const matchReason = procReasons.join(' · ');

    const diagnostic = buildDiagnosticObject({
      doc,
      titleInfo,
      primarySignerName,
      extractedProfile,
      clientSignersCount: clientSigners.length,
      ignoredFirmSignersCount,
      folderExclusion: noExclusion,
      driveFolder,
      driveMatch,
      calendarDetail,
      matchedSources,
      auditStatus: 'procedural_non_contract',
      linkageStatus,
      matchScore,
      matchReason,
    });

    const item: ZapSignCrossReferenceItem = {
      doc,
      primarySignerName,
      auditStatus: 'procedural_non_contract',
      linkageStatus,
      matchedSources,
      matchScore,
      matchReason,
      inSpreadsheet: false,
      driveFolder,
      calendarMatch,
      extractedProfile,
      diagnostic,
    };

    return { item, diagnostic, sheetMatches: [] };
  }

  // 8. Truly pending spreadsheet registration (active signed contract not found in Sheets)
  const hasSecondarySource = Boolean(driveFolder || calendarMatch);
  const linkageStatus: ZapSignLinkageStatus = hasSecondarySource
    ? 'vinculado_drive_ou_agenda_sem_planilha'
    : 'pendente_cadastro';

  const pendingReasons: string[] = ['Não encontrado na planilha'];
  if (driveMatch) {
    pendingReasons.push(driveMatch.reason);
  }
  if (calendarDetail) {
    pendingReasons.push(calendarDetail.reason);
  }
  const matchScore = driveMatch?.score ?? (calendarMatch ? 72 : 0);
  const matchReason = pendingReasons.join(' · ');

  const diagnostic = buildDiagnosticObject({
    doc,
    titleInfo,
    primarySignerName,
    extractedProfile,
    clientSignersCount: clientSigners.length,
    ignoredFirmSignersCount,
    folderExclusion: noExclusion,
    driveFolder,
    driveMatch,
    calendarDetail,
    matchedSources,
    auditStatus: 'missing_in_spreadsheet',
    linkageStatus,
    matchScore,
    matchReason,
  });

  const item: ZapSignCrossReferenceItem = {
    doc,
    primarySignerName,
    auditStatus: 'missing_in_spreadsheet',
    linkageStatus,
    matchedSources,
    matchScore,
    matchReason,
    inSpreadsheet: false,
    driveFolder,
    calendarMatch,
    extractedProfile,
    diagnostic,
  };

  return { item, diagnostic, sheetMatches: [] };
}

/**
 * Pure per-document cross-linkage diagnostic helper across ZapSign, Sheets, Drive, and Calendar.
 */
export function diagnoseZapSignDocument(
  doc: ZapSignSignedDoc,
  clients: ClientCase[],
  driveEtapas: AppsScriptDriveEtapaRow[] = [],
  calendarEvents: AppsScriptCalendarEventRow[] = []
): ZapSignDocumentDiagnostic {
  return reconcileSingleDocument(doc, clients, driveEtapas, calendarEvents)
    .diagnostic;
}

export interface ZapSignMatchResult {
  matchedByClientId: Record<string, ZapSignSignedDoc[]>;
  unmatchedDocs: ZapSignSignedDoc[];
  unmatchedAuditItems: ZapSignCrossReferenceItem[];
  closedAuditItems: ZapSignCrossReferenceItem[];
  excludedFolderItems: ZapSignCrossReferenceItem[];
  proceduralAuditItems: ZapSignCrossReferenceItem[];
  allAuditItems: ZapSignCrossReferenceItem[];
  diagnostics: ZapSignDocumentDiagnostic[];
  diagnosticsByToken: Record<string, ZapSignDocumentDiagnostic>;
}

/**
 * Deterministic multi-source reconciliation engine:
 * Crosses ZapSign signed documents against:
 * 1) Google Sheets (Honorários `clients`) via CPF, phone, or smart name matching
 * 2) Google Drive (`driveEtapas`) via prefix-stripped & fuzzy folder matching
 * 3) Google Calendar (`calendarEvents`) via billing event detection (name, CPF, phone)
 *
 * Rigidly excludes ignored folders (`ZZ - Encerrados`, `Docs Faltavam`, `Fechados do Escritório`),
 * separates non-contract procedural files (`PROCESSO ...`), and returns a complete
 * `ZapSignDocumentDiagnostic` object for every audited document.
 */
export function matchZapSignToClients(
  clients: ClientCase[],
  signedDocs: ZapSignSignedDoc[],
  driveEtapas: AppsScriptDriveEtapaRow[] = [],
  calendarEvents: AppsScriptCalendarEventRow[] = []
): ZapSignMatchResult {
  const matchedByClientId: Record<string, ZapSignSignedDoc[]> = {};
  const unmatchedDocs: ZapSignSignedDoc[] = [];
  const unmatchedAuditItems: ZapSignCrossReferenceItem[] = [];
  const closedAuditItems: ZapSignCrossReferenceItem[] = [];
  const excludedFolderItems: ZapSignCrossReferenceItem[] = [];
  const proceduralAuditItems: ZapSignCrossReferenceItem[] = [];
  const allAuditItems: ZapSignCrossReferenceItem[] = [];
  const diagnostics: ZapSignDocumentDiagnostic[] = [];
  const diagnosticsByToken: Record<string, ZapSignDocumentDiagnostic> = {};

  const safeClients = Array.isArray(clients) ? clients : [];
  const safeDocs = Array.isArray(signedDocs) ? signedDocs.filter(Boolean) : [];
  const safeDrive = Array.isArray(driveEtapas) ? driveEtapas : [];
  const safeCalendar = Array.isArray(calendarEvents) ? calendarEvents : [];

  for (const doc of safeDocs) {
    const { item, diagnostic, sheetMatches } = reconcileSingleDocument(
      doc,
      safeClients,
      safeDrive,
      safeCalendar
    );

    allAuditItems.push(item);
    diagnostics.push(diagnostic);
    diagnosticsByToken[doc.token] = diagnostic;

    if (
      sheetMatches.length > 0 &&
      diagnostic.folderExclusion.source !== 'zapsign'
    ) {
      for (const m of sheetMatches) {
        if (!matchedByClientId[m.client.id]) {
          matchedByClientId[m.client.id] = [];
        }
        matchedByClientId[m.client.id].push(doc);
      }
    }

    if (diagnostic.folderExclusion.excluded) {
      if (diagnostic.folderExclusion.isClosedArchive) {
        closedAuditItems.push(item);
      }
      excludedFolderItems.push(item);
      continue;
    }

    if (item.auditStatus === 'matched_spreadsheet') {
      continue;
    }

    if (item.auditStatus === 'procedural_non_contract') {
      proceduralAuditItems.push(item);
      continue;
    }

    unmatchedDocs.push(doc);
    unmatchedAuditItems.push(item);
  }

  const compareDatesDesc = (a?: string, b?: string) =>
    String(b ?? '').localeCompare(String(a ?? ''));

  for (const clientId of Object.keys(matchedByClientId)) {
    matchedByClientId[clientId].sort((a, b) =>
      compareDatesDesc(a.signedAt, b.signedAt)
    );
  }

  unmatchedAuditItems.sort((a, b) =>
    compareDatesDesc(a.doc.signedAt, b.doc.signedAt)
  );
  unmatchedDocs.sort((a, b) => compareDatesDesc(a.signedAt, b.signedAt));
  proceduralAuditItems.sort((a, b) =>
    compareDatesDesc(a.doc.signedAt, b.doc.signedAt)
  );

  return {
    matchedByClientId,
    unmatchedDocs,
    unmatchedAuditItems,
    closedAuditItems,
    excludedFolderItems,
    proceduralAuditItems,
    allAuditItems,
    diagnostics,
    diagnosticsByToken,
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
