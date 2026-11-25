import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import handler from '../../api/auth/sms-hook.js';
import { sendSms, SmsProviderError } from '../../lib/sms/twilio.js';
import { smsText } from '../../lib/sms/messages.js';
import { twilioConfig, smsDailyLimit } from '../../lib/env.js';

const ENV_KEYS = [
  'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'IP_HASH_SECRET', 'SEND_SMS_HOOK_SECRET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_MESSAGING_SERVICE_SID', 'SMS_DAILY_LIMIT',
];
const SECRET = `v1,whsec_${crypto.randomBytes(24).toString('base64')}`;
const ACCOUNT = 'AC' + '0123456789abcdef'.repeat(2);
const TOKEN = 'fedcba9876543210fedcba9876543210';
const PHONE = '+22890123456';
const OTP = '482913';

let saved;
let calls;
let state;
let originalFetch;
let originalConsole;
let logs;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function fakeNetwork(url, init) {
  calls.push({ url: String(url), init });
  const u = String(url);
  if (u.includes('/rpc/consume_rate_limit')) {
    const body = JSON.parse(init.body);
    return jsonResponse(body.p_key.startsWith('sms-phone:') ? state.phoneAllowed : state.globalAllowed);
  }
  if (u.includes('/rpc/claim_sms_delivery')) {
    const id = JSON.parse(init.body).p_id;
    if (state.claimed.has(id)) return jsonResponse(false);
    state.claimed.add(id);
    return jsonResponse(true);
  }
  if (u.includes('/rpc/release_sms_delivery')) {
    state.claimed.delete(JSON.parse(init.body).p_id);
    return new Response(null, { status: 204 });
  }
  if (u.startsWith('https://api.twilio.com/')) return jsonResponse(state.twilio.body, state.twilio.status);
  throw new Error(`appel inattendu : ${u}`);
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    SUPABASE_URL: 'https://abcdefgh.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_ZYXWVUTS87654321',
    IP_HASH_SECRET: 'x'.repeat(40),
    SEND_SMS_HOOK_SECRET: SECRET,
    TWILIO_ACCOUNT_SID: ACCOUNT,
    TWILIO_AUTH_TOKEN: TOKEN,
    TWILIO_FROM: '+15005550006',
  });
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  delete process.env.SMS_DAILY_LIMIT;
  calls = [];
  state = {
    phoneAllowed: true,
    globalAllowed: true,
    claimed: new Set(),
    twilio: { status: 201, body: { sid: 'SM' + 'a'.repeat(32), status: 'queued' } },
  };
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => fakeNetwork(url, init);
  logs = [];
  originalConsole = { error: console.error, warn: console.warn, info: console.info };
  for (const level of ['error', 'warn', 'info']) console[level] = (...a) => logs.push(a.join(' '));
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = originalFetch;
  Object.assign(console, originalConsole);
});

const payload = ({ phone = PHONE, otp = OTP } = {}) => ({
  user: { phone },
  sms: { otp },
});

function signed(body, { secret = SECRET, id = 'msg_sms_1', timestamp = new Date() } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = new Webhook(secret.replace(/^v1,/, '')).sign(id, timestamp, text);
  return new Request('https://site.test/api/auth/sms-hook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'webhook-signature': signature,
    },
    body: text,
  });
}

const twilioCalls = () => calls.filter((c) => c.url.startsWith('https://api.twilio.com/'));
const call = (request) => handler.fetch(request);

/* ── Garde-fous de la requête ──────────────────────────────── */

test('méthode GET refusée (405) ; type de contenu refusé (415)', async () => {
  assert.equal((await call(new Request('https://site.test/api/auth/sms-hook'))).status, 405);
  const res = await call(new Request('https://site.test/api/auth/sms-hook', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }));
  assert.equal(res.status, 415);
  assert.equal(twilioCalls().length, 0);
});

test('signature fausse ou horodatage ancien : 401, aucun SMS', async () => {
  const other = `v1,whsec_${crypto.randomBytes(24).toString('base64')}`;
  assert.equal((await call(signed(payload(), { secret: other }))).status, 401);
  assert.equal((await call(signed(payload(), { timestamp: new Date(Date.now() - 10 * 60 * 1000) }))).status, 401);
  assert.equal(twilioCalls().length, 0);
});

test('payload standard Supabase accepté sans sms_type', async () => {
  const res = await call(signed(payload()));

  assert.equal(res.status, 200);
  assert.equal(twilioCalls().length, 1);
});

test('numéro ou code mal formés : 400, aucun SMS', async () => {
  assert.equal((await call(signed(payload({ phone: '90123456' })))).status, 400);
  assert.equal((await call(signed(payload({ otp: 'ab12cd' })))).status, 400);
  assert.equal((await call(signed('{ pas du json'))).status, 400);
  assert.equal(twilioCalls().length, 0);
});

test('corps trop volumineux : 413 avant toute analyse', async () => {
  assert.equal((await call(signed('x'.repeat(20 * 1024)))).status, 413);
});

/* ── Envoi ─────────────────────────────────────────────────── */

test('changement de téléphone : SMS envoyé à Twilio, réponse vide 200 (format attendu par Supabase)', async () => {
  const res = await call(signed(payload()));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
  assert.equal(twilioCalls().length, 1);
  const sent = new URLSearchParams(twilioCalls()[0].init.body);
  assert.equal(sent.get('To'), PHONE);
  assert.equal(sent.get('From'), '+15005550006');
  assert.match(sent.get('Body'), new RegExp(OTP));
  assert.equal(sent.get('MessagingServiceSid'), null);
  assert.equal(twilioCalls()[0].url, `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`);
});

test('succès : journaux sans numéro ni code', async () => {
  await call(signed(payload()));
  const visible = logs.join(' ');
  assert.ok(logs.some((l) => /envoi accepté/.test(l)), 'le succès est journalisé');
  assert.doesNotMatch(visible, /22890123456/, 'pas de numéro');
  assert.doesNotMatch(visible, new RegExp(OTP), 'pas de code');
});

test('authentification Twilio : identifiants en Basic, jamais dans l\'URL', async () => {
  await call(signed(payload()));
  const auth = twilioCalls()[0].init.headers.Authorization;
  assert.equal(auth, `Basic ${Buffer.from(`${ACCOUNT}:${TOKEN}`).toString('base64')}`);
  assert.equal(twilioCalls()[0].url.includes(TOKEN), false);
});

test('service de messagerie configuré : utilisé à la place du numéro d\'expéditeur', async () => {
  process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG' + 'b'.repeat(32);
  delete process.env.TWILIO_FROM;
  await call(signed(payload()));
  const sent = new URLSearchParams(twilioCalls()[0].init.body);
  assert.equal(sent.get('MessagingServiceSid'), 'MG' + 'b'.repeat(32));
  assert.equal(sent.get('From'), null);
});

test('SMS de vérification : message générique avec le code', async () => {
  await call(signed(payload()));

  const body = new URLSearchParams(
    twilioCalls()[0].init.body
  ).get('Body');

  assert.match(body, /code de vérification/);
  assert.match(body, new RegExp(OTP));
});

test('Twilio qui répond sans identifiant de message : considéré comme NON accepté (502)', async () => {
  state.twilio = { status: 201, body: { status: 'queued' } };
  const res = await call(signed(payload()));
  assert.equal(res.status, 502);
});

/* ── Dédoublonnage et nouvel essai ─────────────────────────── */

test('même appel reçu deux fois : un seul SMS', async () => {
  await call(signed(payload(), { id: 'msg_dup' }));
  const second = await call(signed(payload(), { id: 'msg_dup' }));
  assert.equal(second.status, 200);
  assert.equal(twilioCalls().length, 1);
});

test('échec de Twilio : la trace est retirée, le nouvel essai envoie bien le SMS', async () => {
  state.twilio = { status: 500, body: { code: 20500, message: 'erreur' } };
  const first = await call(signed(payload(), { id: 'msg_retry' }));
  assert.equal(first.status, 502);
  assert.equal(state.claimed.has('msg_retry'), false, 'trace retirée');

  state.twilio = { status: 201, body: { sid: 'SM' + 'c'.repeat(32) } };
  const second = await call(signed(payload(), { id: 'msg_retry' }));
  assert.equal(second.status, 200);
  assert.equal(twilioCalls().length, 2, 'un second envoi réel a eu lieu');
});

/* ── Limites ───────────────────────────────────────────────── */

test('plus de 3 SMS par numéro et par heure : 429, aucun SMS', async () => {
  state.phoneAllowed = false;
  const res = await call(signed(payload()));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '3600');
  assert.equal(twilioCalls().length, 0);
});

test('plafond quotidien atteint : 429, aucun SMS', async () => {
  state.globalAllowed = false;
  const res = await call(signed(payload()));
  assert.equal(res.status, 429);
  assert.equal(twilioCalls().length, 0);
});

test('la limite par numéro porte sur un HACHAGE du numéro, jamais sur le numéro', async () => {
  await call(signed(payload()));
  const limit = calls.find((c) => c.url.includes('consume_rate_limit') && JSON.parse(c.init.body).p_key.startsWith('sms-phone:'));
  const key = JSON.parse(limit.init.body).p_key;
  assert.match(key, /^sms-phone:[a-f0-9]{40}$/);
  assert.equal(key.includes(PHONE), false);
});

/* ── Configuration ─────────────────────────────────────────── */

test('configuration Twilio manquante ou invalide : 500 générique, aucun SMS', async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  const missing = await call(signed(payload()));
  assert.equal(missing.status, 500);
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.TWILIO_ACCOUNT_SID = 'XX' + 'a'.repeat(32);
  const invalid = await call(signed(payload()));
  assert.equal(invalid.status, 500);
  assert.equal(twilioCalls().length, 0);
});

test('expéditeur invalide refusé (plus de 11 caractères alphanumériques)', () => {
  process.env.TWILIO_FROM = 'YouthConnect';
  assert.throws(() => twilioConfig(process.env), /TWILIO_FROM/);
  process.env.TWILIO_FROM = 'YOUTHCONN';
  assert.equal(twilioConfig(process.env).from, 'YOUTHCONN');
});

test('plafond quotidien : entier positif obligatoire', () => {
  assert.equal(smsDailyLimit({}), 500);
  assert.throws(() => smsDailyLimit({ SMS_DAILY_LIMIT: '0' }), /entier positif/);
  assert.throws(() => smsDailyLimit({ SMS_DAILY_LIMIT: 'beaucoup' }), /entier positif/);
});

/* ── Confidentialité ───────────────────────────────────────── */

test('journaux et réponses : ni le code, ni le numéro, ni le jeton Twilio', async () => {
  state.twilio = { status: 500, body: { code: 21211, message: 'numéro invalide' } };
  const res = await call(signed(payload(), { id: 'msg_private' }));
  const visible = `${await res.text()} ${logs.join(' ')}`;
  assert.doesNotMatch(visible, new RegExp(OTP));
  assert.doesNotMatch(visible, /\+22890123456|22890123456/);
  assert.doesNotMatch(visible, new RegExp(TOKEN));
  assert.match(logs.join(' '), /code Twilio 21211/, 'le code d\'erreur Twilio, lui, est journalisé');
});

test('texte du SMS : code seul, sans lien, sans nom, sous 160 caractères', () => {
  const text = smsText({ code: '123456' });
  assert.equal(/https?:\/\//.test(text), false);
  assert.ok(text.length <= 160, `longueur ${text.length}`);
  assert.ok(text.includes('123456'));
});

/* ── Appel direct du client Twilio ─────────────────────────── */

test('client Twilio : erreur sans numéro ni jeton, et délai maximal', async () => {
  const refusing = async () => new Response(JSON.stringify({ code: 21608 }), { status: 400 });
  await assert.rejects(
    sendSms({ accountSid: ACCOUNT, authToken: TOKEN, to: PHONE, body: 'x', from: '+15005550006', fetchImpl: refusing }),
    (err) => err instanceof SmsProviderError && err.status === 400 && err.twilioCode === 21608 && !/22890|fedcba/.test(err.message),
  );
  const hanging = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))));
  await assert.rejects(
    sendSms({ accountSid: ACCOUNT, authToken: TOKEN, to: PHONE, body: 'x', from: '+15005550006', fetchImpl: hanging, timeoutMs: 20 }),
    /délai dépassé/,
  );
});
