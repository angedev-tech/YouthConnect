import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import handler from '../../api/auth/email-hook.js';

const ENV_KEYS = ['VERCEL_ENV', 'EMAIL_FROM', 'APP_URL', 'RESEND_API_KEY', 'SEND_EMAIL_HOOK_SECRET'];
const SECRET = `v1,whsec_${crypto.randomBytes(24).toString('base64')}`;
const RESEND_KEY = 're_test_cle_resend_987654';
const SITE = 'https://youthconnect-test.vercel.app';
const HASH = 'a'.repeat(64);
const HASH_NEW = 'b'.repeat(64);

let saved;
let resendCalls;
let resendStatus;
let originalFetch;
let logs;
let originalConsole;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    VERCEL_ENV: 'preview',
    EMAIL_FROM: 'YouthConnect <onboarding@resend.dev>',
    APP_URL: SITE,
    RESEND_API_KEY: RESEND_KEY,
    SEND_EMAIL_HOOK_SECRET: SECRET,
  });
  resendCalls = [];
  resendStatus = 200;
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== 'https://api.resend.com/emails') throw new Error(`appel inattendu : ${url}`);
    resendCalls.push({ body: JSON.parse(init.body), idempotencyKey: init.headers['Idempotency-Key'] });
    if (resendStatus !== 200) return new Response('{"message":"erreur"}', { status: resendStatus });
    return new Response(JSON.stringify({ id: `email_${resendCalls.length}` }), { status: 200 });
  };
  logs = [];
  originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const level of ['log', 'info', 'warn', 'error']) {
    console[level] = (...args) => logs.push(args.join(' '));
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = originalFetch;
  Object.assign(console, originalConsole);
});

const signupPayload = (email = 'amina@exemple.fr') => ({
  user: { email },
  email_data: { email_action_type: 'signup', token_hash: HASH, token: '123456', redirect_to: SITE, site_url: SITE },
});

function signedRequest(payload, { secret = SECRET, id = 'msg_test_1', timestamp = new Date(), raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  const signature = new Webhook(secret.replace(/^v1,/, '')).sign(id, timestamp, body);
  return new Request(`${SITE}/api/auth/email-hook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'webhook-signature': signature,
    },
    body,
  });
}

const call = (request) => handler.fetch(request);

test('méthode GET refusée (405)', async () => {
  const res = await call(new Request(`${SITE}/api/auth/email-hook`));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
});

test('type de contenu autre que JSON refusé (415)', async () => {
  const res = await call(new Request(`${SITE}/api/auth/email-hook`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }));
  assert.equal(res.status, 415);
  assert.equal(resendCalls.length, 0);
});

test('confirmation d\'inscription valide : e-mail envoyé, réponse vide 200 (format attendu par Supabase)', async () => {
  const res = await call(signedRequest(signupPayload()));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
  assert.equal(resendCalls.length, 1);
  const sent = resendCalls[0].body;
  assert.deepEqual(sent.to, ['amina@exemple.fr']);
  assert.match(sent.subject, /Confirme ton adresse/);
  assert.ok(sent.html.includes(`${SITE}/auth/confirm?token_hash=${HASH}`));
  assert.equal(resendCalls[0].idempotencyKey, 'msg_test_1:0');
});

test('signature fausse : refusée (401), rien n\'est envoyé', async () => {
  const other = `v1,whsec_${crypto.randomBytes(24).toString('base64')}`;
  const res = await call(signedRequest(signupPayload(), { secret: other }));
  assert.equal(res.status, 401);
  assert.equal(resendCalls.length, 0);
});

test('corps modifié après signature : refusé (401)', async () => {
  const signed = JSON.stringify(signupPayload());
  const tampered = signed.replace('amina@exemple.fr', 'pirate@exemple.fr');
  const request = signedRequest(signupPayload(), { raw: signed });
  const forged = new Request(request.url, { method: 'POST', headers: request.headers, body: tampered });
  const res = await call(forged);
  assert.equal(res.status, 401);
  assert.equal(resendCalls.length, 0);
});

test('appel rejoué avec un horodatage ancien : refusé (401)', async () => {
  const res = await call(signedRequest(signupPayload(), { timestamp: new Date(Date.now() - 10 * 60 * 1000) }));
  assert.equal(res.status, 401);
  assert.equal(resendCalls.length, 0);
});

test('changement d\'adresse : deux e-mails, clés d\'idempotence distinctes', async () => {
  const payload = {
    user: { email: 'amina@exemple.fr', new_email: 'nouvelle@exemple.fr' },
    email_data: { email_action_type: 'email_change', token_hash: HASH, token_hash_new: HASH_NEW, token: '1', token_new: '2', redirect_to: SITE, site_url: SITE },
  };
  const res = await call(signedRequest(payload, { id: 'msg_change' }));
  assert.equal(res.status, 200);
  assert.equal(resendCalls.length, 2);
  assert.deepEqual(resendCalls.map((c) => c.body.to[0]), ['amina@exemple.fr', 'nouvelle@exemple.fr']);
  assert.deepEqual(resendCalls.map((c) => c.idempotencyKey), ['msg_change:0', 'msg_change:1']);
});

test('type non géré (magiclink) : refusé (422), aucun envoi silencieux', async () => {
  const payload = { ...signupPayload(), email_data: { ...signupPayload().email_data, email_action_type: 'magiclink' } };
  const res = await call(signedRequest(payload));
  assert.equal(res.status, 422);
  assert.equal(resendCalls.length, 0);
});

test('charge utile invalide (JSON cassé, signé) : refusée (400)', async () => {
  const res = await call(signedRequest(null, { raw: '{"user": ' }));
  assert.equal(res.status, 400);
  assert.equal(resendCalls.length, 0);
});

test('fournisseur qui refuse : 502, Supabase reçoit un échec (pas de faux succès)', async () => {
  resendStatus = 500;
  const res = await call(signedRequest(signupPayload()));
  assert.equal(res.status, 502);
  assert.notEqual(await res.text(), '');
});

test('configuration manquante : 500 générique, aucun envoi', async () => {
  delete process.env.SEND_EMAIL_HOOK_SECRET;
  const res = await call(signedRequest(signupPayload()));
  assert.equal(res.status, 500);
  assert.equal(resendCalls.length, 0);
});

test('domaine de test refusé en production : 500, aucun envoi', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.APP_URL = 'https://youthconnect.exemple.fr';
  const res = await call(signedRequest(signupPayload()));
  assert.equal(res.status, 500);
  assert.equal(resendCalls.length, 0);
});

test('corps trop volumineux : 413 avant toute analyse', async () => {
  const res = await call(signedRequest(null, { raw: 'x'.repeat(70 * 1024) }));
  assert.equal(res.status, 413);
});

test('journaux : aucune adresse e-mail, aucune clé, aucun secret, même en cas d\'échec', async () => {
  resendStatus = 500;
  await call(signedRequest(signupPayload()));
  await call(signedRequest(signupPayload(), { secret: `v1,whsec_${crypto.randomBytes(24).toString('base64')}` }));
  const all = logs.join('\n');
  assert.doesNotMatch(all, /amina@|@exemple/, 'pas d\'adresse dans les journaux');
  assert.doesNotMatch(all, /re_test_cle|whsec_|a{64}|b{64}/, 'pas de clé, de secret ni de jeton');
});

test('erreurs renvoyées au client : aucune clé ni adresse', async () => {
  resendStatus = 500;
  const res = await call(signedRequest(signupPayload()));
  const body = await res.text();
  assert.doesNotMatch(body, /re_test_cle|whsec_|amina@/);
});
