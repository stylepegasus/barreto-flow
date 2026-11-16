import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AUTHORIZED_EMAILS,
  isAuthorizedEmail,
  normalizeEmail,
  UNAUTHORIZED_USER_MESSAGE,
} from './authAllowlist';
import { verifyFirebaseIdTokenAndAllowlist } from './serverAuth';

function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createSignedJwt(
  privateKeyPem: string,
  kid: string,
  claims: Record<string, unknown>
): string {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = toBase64Url(JSON.stringify(claims));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = toBase64Url(signer.sign(privateKeyPem));
  return `${header}.${payload}.${signature}`;
}

test('isAuthorizedEmail allows the 3 authorized emails regardless of casing or spaces', () => {
  assert.equal(AUTHORIZED_EMAILS.length, 3);
  assert.equal(isAuthorizedEmail('stylepegasus.snkrs@gmail.com'), true);
  assert.equal(isAuthorizedEmail('  STYLEPEGASUS.SNKRS@GMAIL.COM  '), true);
  assert.equal(isAuthorizedEmail('BarretoAdvocacia01@Gmail.Com'), true);
  assert.equal(isAuthorizedEmail('agendabarretoadvocacia@gmail.com'), true);
  assert.equal(isAuthorizedEmail('\tAgendaBarretoAdvocacia@GMAIL.COM\n'), true);
});

test('isAuthorizedEmail rejects other emails, domains, empty values, and lookalikes', () => {
  assert.equal(isAuthorizedEmail('intruso@gmail.com'), false);
  assert.equal(isAuthorizedEmail('barretoadvocacia01@hotmail.com'), false);
  assert.equal(isAuthorizedEmail('barretoadvocacia01@gmail.com.br'), false);
  assert.equal(isAuthorizedEmail('stylepegasus@gmail.com'), false);
  assert.equal(isAuthorizedEmail(''), false);
  assert.equal(isAuthorizedEmail('   '), false);
  assert.equal(isAuthorizedEmail(null), false);
  assert.equal(isAuthorizedEmail(undefined), false);
  assert.equal(normalizeEmail(' Test@Gmail.Com '), 'test@gmail.com');
  assert.equal(
    UNAUTHORIZED_USER_MESSAGE,
    'PODE FECHAR A ABA! VOCÊ NÃO ESTÁ AUTORIZADO, MALANDRO(a)!'
  );
});

test('verifyFirebaseIdTokenAndAllowlist enforces token validity (401) and allowlist (403/200)', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const projectId = 'gen-lang-client-0925403191';
  const kid = 'test-key-1';
  const nowSec = 1_750_000_000;
  const certsProvider = async () => ({ [kid]: publicKey });

  // Missing header -> 401
  const missingRes = await verifyFirebaseIdTokenAndAllowlist(undefined, {
    projectId,
    nowSeconds: nowSec,
    certsProvider,
  });
  assert.equal(missingRes.ok, false);
  assert.equal(missingRes.status, 401);

  // Expired token -> 401
  const expiredToken = createSignedJwt(privateKey, kid, {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    sub: 'uid-1',
    iat: nowSec - 7200,
    exp: nowSec - 10,
    email: 'barretoadvocacia01@gmail.com',
  });
  const expiredRes = await verifyFirebaseIdTokenAndAllowlist(
    `Bearer ${expiredToken}`,
    { projectId, nowSeconds: nowSec, certsProvider }
  );
  assert.equal(expiredRes.ok, false);
  assert.equal(expiredRes.status, 401);

  // Valid token for unauthorized email -> 403
  const unauthorizedToken = createSignedJwt(privateKey, kid, {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    sub: 'uid-2',
    iat: nowSec - 60,
    exp: nowSec + 3600,
    email: 'invasor@gmail.com',
  });
  const unauthorizedRes = await verifyFirebaseIdTokenAndAllowlist(
    `Bearer ${unauthorizedToken}`,
    { projectId, nowSeconds: nowSec, certsProvider }
  );
  assert.equal(unauthorizedRes.ok, false);
  assert.equal(unauthorizedRes.status, 403);

  // Valid token for authorized email (mixed case) -> 200
  const authorizedToken = createSignedJwt(privateKey, kid, {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    sub: 'uid-3',
    iat: nowSec - 60,
    exp: nowSec + 3600,
    email: 'StylePegasus.Snkrs@Gmail.com',
  });
  const authorizedRes = await verifyFirebaseIdTokenAndAllowlist(
    `Bearer ${authorizedToken}`,
    { projectId, nowSeconds: nowSec, certsProvider }
  );
  assert.equal(authorizedRes.ok, true);
  assert.equal(authorizedRes.status, 200);
  assert.equal(authorizedRes.email, 'stylepegasus.snkrs@gmail.com');
});
