import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import { parseWebhookSecret, verifyWebhook, SignatureError } from '../../lib/webhooks.js';

const secretText = `whsec_${crypto.randomBytes(24).toString('base64')}`;
const key = parseWebhookSecret(secretText);
const body = JSON.stringify({ user: { email: 'amina@exemple.fr' }, email_data: { token_hash: 'a'.repeat(64), é: 'ok' } });

// Signature produite par la bibliothèque de référence
function signedBy(secret, { id = 'msg_123', timestamp = new Date(), payload = body } = {}) {
  const sig = new Webhook(secret).sign(id, timestamp, payload);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': sig,
  };
}
const headersFrom = (obj) => new Headers(obj);

test('accepte une signature produite par la bibliothèque officielle', () => {
  const headers = headersFrom(signedBy(secretText));
  assert.equal(verifyWebhook({ key, headers, rawBody: body }), true);
});

test('rejette un corps modifié d\'un seul caractère', () => {
  const headers = headersFrom(signedBy(secretText));
  assert.throws(() => verifyWebhook({ key, headers, rawBody: body.replace('ok', 'ko') }), SignatureError);
});

test('rejette un corps re-sérialisé (même contenu, autres octets)', () => {
  const headers = headersFrom(signedBy(secretText));
  const reserialized = JSON.stringify(JSON.parse(body), null, 2);
  assert.notEqual(reserialized, body);
  assert.throws(() => verifyWebhook({ key, headers, rawBody: reserialized }), /signature invalide/);
});

test('rejette un horodatage hors tolérance de 5 minutes (rejeu)', () => {
  const old = new Date(Date.now() - 6 * 60 * 1000);
  const headers = headersFrom(signedBy(secretText, { timestamp: old }));
  assert.throws(() => verifyWebhook({ key, headers, rawBody: body }), /hors tolérance/);
});

test('rejette un horodatage dans le futur au-delà de la tolérance', () => {
  const future = new Date(Date.now() + 6 * 60 * 1000);
  const headers = headersFrom(signedBy(secretText, { timestamp: future }));
  assert.throws(() => verifyWebhook({ key, headers, rawBody: body }), /hors tolérance/);
});

test('rejette une signature faite avec un autre secret', () => {
  const other = `whsec_${crypto.randomBytes(24).toString('base64')}`;
  const headers = headersFrom(signedBy(other));
  assert.throws(() => verifyWebhook({ key, headers, rawBody: body }), /signature invalide/);
});

test('rejette une signature inventée', () => {
  const headers = headersFrom({
    'webhook-id': 'msg_x',
    'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
    'webhook-signature': `v1,${crypto.randomBytes(32).toString('base64')}`,
  });
  assert.throws(() => verifyWebhook({ key, headers, rawBody: body }), /signature invalide/);
});

test('rejette une requête sans en-têtes de signature', () => {
  assert.throws(() => verifyWebhook({ key, headers: new Headers(), rawBody: body }), /en-têtes de signature manquants/);
});

test('accepte plusieurs signatures dans l\'en-tête (rotation de clé)', () => {
  const good = signedBy(secretText);
  const headers = headersFrom({
    ...good,
    'webhook-signature': `v1,${crypto.randomBytes(32).toString('base64')} ${good['webhook-signature']}`,
  });
  assert.equal(verifyWebhook({ key, headers, rawBody: body }), true);
});

test('secret : formes « v1,whsec_… » et « whsec_… » donnent la même clé ; forme invalide refusée', () => {
  assert.deepEqual(parseWebhookSecret(`v1,${secretText}`), key);
  assert.throws(() => parseWebhookSecret('pas-un-secret'), /whsec_/);
});
