// Décisions du 19 novembre 2026, côté navigateur : testées avec un faux client Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, AuthFlowError } from '../../js/auth.js';
import { validateBirthDate } from '../../js/validation.js';
import { messageForDatabaseError, GENERIC_MESSAGE } from '../../js/messages.js';

function fakeClient(script = {}) {
  const calls = [];
  const ok = (data = {}) => ({ data, error: null });
  const respond = (name, args, fallback) => (script[name] ? script[name](args) : fallback);
  const record = (name, args) => calls.push({ name, args });
  const client = {
    auth: {
      signInWithOAuth: async (args) => { record('signInWithOAuth', args); return respond('signInWithOAuth', args, ok({ url: 'https://accounts.google.test/o' })); },
      exchangeCodeForSession: async (code) => { record('exchangeCodeForSession', code); return respond('exchangeCodeForSession', code, ok({ session: {} })); },
      updateUser: async (args) => { record('updateUser', args); return respond('updateUser', args, ok({ user: {} })); },
      verifyOtp: async (args) => { record('verifyOtp', args); return respond('verifyOtp', args, ok({ session: {} })); },
    },
    rpc: async (name, args) => { record(`rpc:${name}`, args); return respond(`rpc:${name}`, args, { data: null, error: null }); },
  };
  return { client, calls };
}
const noFetch = async () => { throw new Error('aucun appel réseau attendu'); };
const dateAdulte = '1990-05-12';
const aujourdhui = new Date(Date.UTC(2026, 10, 19));
const dateAgeDe = (ans) => `${2026 - ans}-11-19`;

/* ── Date de naissance (même règle que la base) ─────────────── */

test('date de naissance : 18 ans révolus acceptés, la veille refusée', () => {
  assert.equal(validateBirthDate('2008-11-19', aujourdhui).ok, true, 'exactement 18 ans');
  assert.equal(validateBirthDate('2008-11-20', aujourdhui).ok, false, 'la veille des 18 ans');
  assert.match(validateBirthDate('2010-01-01', aujourdhui).message, /18 ans ou plus/);
});

test('date de naissance : format et dates impossibles refusés', () => {
  assert.equal(validateBirthDate('12/05/1990', aujourdhui).ok, false);
  assert.equal(validateBirthDate('1990-02-31', aujourdhui).ok, false);
  assert.equal(validateBirthDate('', aujourdhui).ok, false);
});

/* ── Connexion Google (D2) ──────────────────────────────────── */

test('Google : redirection vers le fournisseur Google, retour vers la page dédiée', async () => {
  const { client, calls } = fakeClient();
  const r = await createAuth({ client, fetchImpl: noFetch }).signInWithGoogle({ redirectTo: 'https://site.test/auth/callback' });
  assert.deepEqual(calls[0], { name: 'signInWithOAuth', args: { provider: 'google', options: { redirectTo: 'https://site.test/auth/callback' } } });
  assert.equal(r.url, 'https://accounts.google.test/o');
});

test('Google : le code de retour est échangé ; un code mal formé n\'est jamais envoyé', async () => {
  const { client, calls } = fakeClient();
  const auth = createAuth({ client, fetchImpl: noFetch });
  await assert.rejects(auth.exchangeOAuthCode({ code: '<script>' }), /invalide/);
  assert.equal(calls.length, 0);
  await auth.exchangeOAuthCode({ code: 'abcdef-0123456789-xyz' });
  assert.equal(calls[0].args, 'abcdef-0123456789-xyz');
});

/* ── Vérification du téléphone (D3) ─────────────────────────── */

test('téléphone : numéro saisi transformé en format international avant l\'envoi du SMS', async () => {
  const { client, calls } = fakeClient();
  await createAuth({ client, fetchImpl: noFetch }).requestPhoneVerification({ countryCode: '+228', localPhone: '90 12 34 56' });
  assert.deepEqual(calls[0], { name: 'updateUser', args: { phone: '+22890123456' } });
});

test('téléphone : numéro invalide → aucun SMS demandé', async () => {
  const { client, calls } = fakeClient();
  await assert.rejects(
    createAuth({ client, fetchImpl: noFetch }).requestPhoneVerification({ countryCode: '+228', localPhone: '090123456' }),
    (err) => err.fields?.phone !== undefined,
  );
  assert.equal(calls.length, 0);
});

test('code SMS : seulement 6 chiffres, vérifié avec le type changement de téléphone', async () => {
  const { client, calls } = fakeClient();
  const auth = createAuth({ client, fetchImpl: noFetch });
  await assert.rejects(auth.verifyPhoneCode({ phone: '+22890123456', token: '12345' }), /6 chiffres/);
  assert.equal(calls.length, 0);
  await auth.verifyPhoneCode({ phone: '+22890123456', token: '482913' });
  assert.deepEqual(calls[0].args, { phone: '+22890123456', token: '482913', type: 'phone_change' });
});

/* ── Complétion du profil après Google (D1, D2) ─────────────── */

const profilValide = {
  username: 'ama_google', birthDate: dateAdulte, termsAccepted: true, termsVersion: '2026-11-18',
  firstName: 'Ama', lastName: 'Test',
};

test('complétion : appel de la fonction de la base avec les paramètres attendus', async () => {
  const { client, calls } = fakeClient();
  await createAuth({ client, fetchImpl: noFetch }).completeOnboarding(profilValide);
  assert.deepEqual(calls[0], {
    name: 'rpc:complete_onboarding',
    args: { p_username: 'ama_google', p_birth_date: dateAdulte, p_terms_version: '2026-11-18', p_first_name: 'Ama', p_last_name: 'Test' },
  });
});

test('complétion : mineur ou CGU non acceptées → aucun appel à la base', async () => {
  const { client, calls } = fakeClient();
  const auth = createAuth({ client, fetchImpl: noFetch });
  await assert.rejects(auth.completeOnboarding({ ...profilValide, birthDate: dateAgeDe(17) }), (err) => err.fields?.birthDate !== undefined);
  await assert.rejects(auth.completeOnboarding({ ...profilValide, termsAccepted: false }), (err) => err.fields?.terms !== undefined);
  await assert.rejects(auth.completeOnboarding({ ...profilValide, username: 'a' }), (err) => err.fields?.username !== undefined);
  assert.equal(calls.length, 0, 'un mineur n\'est jamais transmis à la base');
});

test('complétion : refus de la base affiché tel quel (message contrôlé)', async () => {
  const { client } = fakeClient({
    'rpc:complete_onboarding': () => ({ data: null, error: { code: '23505', message: 'Ce pseudo est déjà pris.' } }),
  });
  await assert.rejects(createAuth({ client, fetchImpl: noFetch }).completeOnboarding(profilValide), (err) => {
    assert.equal(err.message, 'Ce pseudo est déjà pris.');
    return true;
  });
});

/* ── Traduction des erreurs de la base ──────────────────────── */

test('erreurs de la base : messages contrôlés affichés, détails techniques jamais', () => {
  assert.equal(messageForDatabaseError({ code: '22023', message: 'Inscription réservée aux personnes âgées de 18 ans ou plus.' }), 'Inscription réservée aux personnes âgées de 18 ans ou plus.');
  assert.equal(messageForDatabaseError({ code: '42501', message: 'permission denied for table profiles' }), GENERIC_MESSAGE);
  assert.equal(messageForDatabaseError({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' }), GENERIC_MESSAGE);
  assert.equal(messageForDatabaseError({ code: 'XX000', message: 'erreur interne' }), GENERIC_MESSAGE);
});

test('AuthFlowError : porte un code et les champs en erreur', () => {
  const err = new AuthFlowError('Pseudo invalide', 'validation', { username: 'Pseudo invalide' });
  assert.equal(err.code, 'validation');
  assert.equal(err.fields.username, 'Pseudo invalide');
});
