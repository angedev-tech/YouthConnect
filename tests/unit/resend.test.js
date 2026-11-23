import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail, EmailProviderError } from '../../lib/email/resend.js';

const API_KEY = 're_secret_cle_de_test_123456';
const base = { apiKey: API_KEY, from: 'YouthConnect <onboarding@resend.dev>', to: 'amina@exemple.fr', subject: 'Sujet', html: '<p>x</p>', text: 'x' };

const okFetch = (calls, body = { id: 'email_abc' }) => async (url, init) => {
  calls.push({ url, init });
  return new Response(JSON.stringify(body), { status: 200 });
};

test('envoi : bonne adresse, bon en-tête d\'autorisation, corps conforme', async () => {
  const calls = [];
  const res = await sendEmail({ ...base, idempotencyKey: 'msg_1:0', fetchImpl: okFetch(calls) });
  assert.deepEqual(res, { id: 'email_abc' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${API_KEY}`);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.to, ['amina@exemple.fr']);
  assert.equal(sent.subject, 'Sujet');
});

test('clé d\'idempotence transmise, tronquée à 256 caractères', async () => {
  const calls = [];
  await sendEmail({ ...base, idempotencyKey: 'x'.repeat(300), fetchImpl: okFetch(calls) });
  assert.equal(calls[0].init.headers['Idempotency-Key'].length, 256);
});

test('sans identifiant renvoyé, l\'envoi n\'est PAS considéré comme réussi', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({}), { status: 200 });
  await assert.rejects(sendEmail({ ...base, fetchImpl }), (err) => err instanceof EmailProviderError);
});

test('refus du fournisseur : erreur avec le code HTTP, sans clé ni contenu', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ message: 'refusé' }), { status: 403 });
  await assert.rejects(sendEmail({ ...base, fetchImpl }), (err) => {
    assert.equal(err.status, 403);
    assert.doesNotMatch(err.message + JSON.stringify(err), /re_secret|amina@exemple/);
    return true;
  });
});

test('erreur réseau : erreur propre, sans clé', async () => {
  const fetchImpl = async () => {
    throw new TypeError(`fetch failed pour Bearer ${API_KEY}`);
  };
  await assert.rejects(sendEmail({ ...base, fetchImpl }), (err) => {
    assert.match(err.message, /connexion impossible/);
    assert.doesNotMatch(err.message, /re_secret/);
    return true;
  });
});

test('délai maximal : l\'appel est interrompu', async () => {
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  await assert.rejects(sendEmail({ ...base, fetchImpl, timeoutMs: 30 }), /délai dépassé/);
});
