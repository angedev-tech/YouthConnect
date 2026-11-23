import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyKey, assertPublicKey, assertSecretKey, findSecretMaterial } from '../../lib/keys.js';

// JWT factice (non signé) : seul le rôle compte pour notre classement
const jwt = (role) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.signaturefactice`;
};

const PUBLISHABLE = 'sb_publishable_ABCDEFGH12345678';
const SECRET = 'sb_secret_ZYXWVUTS87654321';

test('classement des clés', () => {
  assert.equal(classifyKey(PUBLISHABLE), 'publishable');
  assert.equal(classifyKey(SECRET), 'secret');
  assert.equal(classifyKey(jwt('anon')), 'legacy-publishable');
  assert.equal(classifyKey(jwt('service_role')), 'secret');
  assert.equal(classifyKey('pas-une-cle'), 'unknown');
  assert.equal(classifyKey(''), 'missing');
  assert.equal(classifyKey(undefined), 'missing');
});

test('la clé publiable (et l\'ancienne clé anon) sont acceptées côté navigateur', () => {
  assert.equal(assertPublicKey(PUBLISHABLE), PUBLISHABLE);
  assert.equal(assertPublicKey(jwt('anon')), jwt('anon'));
});

test('une clé secrète est refusée côté navigateur, sans être affichée', () => {
  for (const secret of [SECRET, jwt('service_role')]) {
    assert.throws(
      () => assertPublicKey(secret),
      (err) => {
        assert.match(err.message, /SECRÈTE/);
        assert.doesNotMatch(err.message, /sb_secret_|eyJ/);
        return true;
      },
    );
  }
});

test('la clé secrète est acceptée côté serveur, la publiable refusée', () => {
  assert.equal(assertSecretKey(SECRET), SECRET);
  assert.equal(assertSecretKey(jwt('service_role')), jwt('service_role'));
  assert.throws(() => assertSecretKey(PUBLISHABLE), /PUBLIABLE/);
  assert.throws(() => assertSecretKey(jwt('anon')), /PUBLIABLE/);
});

test('détection de secrets dans un texte destiné au navigateur', () => {
  const kinds = (text) => findSecretMaterial(text).map((f) => f.kind);
  assert.deepEqual(kinds(`const k = "${SECRET}";`), ['clé secrète Supabase (sb_secret_)']);
  assert.deepEqual(kinds(`x = "whsec_${'A'.repeat(24)}"`), ['secret de webhook (whsec_)']);
  assert.deepEqual(kinds(`k = "re_${'a'.repeat(20)}"`), ['clé API Resend (re_)']);
  assert.deepEqual(kinds(`k = "${jwt('service_role')}"`), ['clé service_role (JWT)']);
  assert.deepEqual(kinds('process.env.RESEND_API_KEY'), ['nom de variable serveur (RESEND_API_KEY)']);
});

test('pas de faux positif sur les clés destinées au navigateur', () => {
  assert.deepEqual(findSecretMaterial(`const key = "${PUBLISHABLE}";`), []);
  assert.deepEqual(findSecretMaterial(`const anon = "${jwt('anon')}";`), []);
  assert.deepEqual(findSecretMaterial('const retry = 3; const re = /x/;'), []);
});
