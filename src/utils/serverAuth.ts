import crypto from 'node:crypto';
import { isAuthorizedEmail, normalizeEmail } from './authAllowlist.ts';

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface CertCache {
  certs: Record<string, string>;
  expiresAtMs: number;
}

let certCache: CertCache | null = null;

export interface VerifiedTokenResult {
  ok: boolean;
  status: 200 | 401 | 403;
  email?: string;
  error?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface FirebaseIdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) return 300;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return 300;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

async function fetchGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && certCache.expiresAtMs > now) {
    return certCache.certs;
  }

  const res = await fetch(GOOGLE_CERTS_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Falha ao obter certificados públicos do Firebase (HTTP ${res.status}).`);
  }

  const certs = (await res.json()) as Record<string, string>;
  const maxAge = parseMaxAgeSeconds(res.headers.get('cache-control'));
  certCache = {
    certs,
    expiresAtMs: now + maxAge * 1000,
  };
  return certs;
}

export async function verifyFirebaseIdTokenAndAllowlist(
  bearerHeader: string | undefined,
  options: {
    projectId: string;
    nowSeconds?: number;
    certsProvider?: () => Promise<Record<string, string>>;
  }
): Promise<VerifiedTokenResult> {
  if (!bearerHeader || !bearerHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      error: 'Sessão não autenticada. Faça login com o Google para continuar.',
    };
  }

  const token = bearerHeader.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      ok: false,
      status: 401,
      error: 'Token de autenticação inválido.',
    };
  }

  const [headerSeg, payloadSeg, sigSeg] = parts;
  const header = decodeBase64UrlJson<JwtHeader>(headerSeg);
  const claims = decodeBase64UrlJson<FirebaseIdTokenClaims>(payloadSeg);

  if (!header || !claims || header.alg !== 'RS256' || !header.kid) {
    return {
      ok: false,
      status: 401,
      error: 'Cabeçalho ou conteúdo do token inválido.',
    };
  }

  try {
    const getCerts = options.certsProvider ?? fetchGooglePublicCerts;
    const certs = await getCerts();
    const publicCertPem = certs[header.kid];
    if (!publicCertPem) {
      return {
        ok: false,
        status: 401,
        error: 'Chave pública de assinatura do token não reconhecida.',
      };
    }

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerSeg}.${payloadSeg}`);
    verifier.end();

    const sigBuffer = Buffer.from(
      sigSeg.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    );
    const signatureValid = verifier.verify(publicCertPem, sigBuffer);
    if (!signatureValid) {
      return {
        ok: false,
        status: 401,
        error: 'Assinatura do token de sessão inválida.',
      };
    }
  } catch {
    return {
      ok: false,
      status: 401,
      error: 'Não foi possível validar a assinatura da sessão.',
    };
  }

  const nowSec = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${options.projectId}`;

  if (claims.aud !== options.projectId || claims.iss !== expectedIssuer) {
    return {
      ok: false,
      status: 401,
      error: 'Token emitido para um projeto inválido.',
    };
  }

  if (
    typeof claims.exp !== 'number' ||
    claims.exp <= nowSec ||
    typeof claims.iat !== 'number' ||
    claims.iat > nowSec + 300 ||
    !claims.sub
  ) {
    return {
      ok: false,
      status: 401,
      error: 'Sessão expirada. Entre novamente com o Google.',
    };
  }

  const email = normalizeEmail(claims.email);
  if (!email) {
    return {
      ok: false,
      status: 403,
      error: 'Conta Google sem e-mail identificado. Acesso negado.',
    };
  }

  if (!isAuthorizedEmail(email)) {
    return {
      ok: false,
      status: 403,
      email,
      error: 'Acesso negado: este e-mail não está na lista de contas autorizadas.',
    };
  }

  return {
    ok: true,
    status: 200,
    email,
  };
}
