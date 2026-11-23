// Parcours d'authentification testés avec un faux client Supabase et un faux serveur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, AuthFlowError } from '../../js/auth.js';

function fakeClient(script = {}) {
  const calls = [];
  const record = (name, args) => calls.push({ name, args });
  const ok = (data = {}) => ({ data, error: null });
  const fail = (code) => ({ data: null, error: Object.assign(new Error(code), { code }) });
  const reply = (name, args, fallback) => (script[name] ? script[name](args) : fallback);
  const auth = {
    signUp: async (args) => { record('signUp', args); return reply('signUp', args, ok({ user: {}, session: null })); },
    signInWithPassword: async (args) => { record('signInWithPassword', args); return reply('signInWithPassword', args, ok({})); },
    signOut: async (args) => { record('signOut', args); return ok(); },
    resetPasswordForEmail: async (email, options) => { record('resetPasswordForEmail', { email, options }); return reply('reset', { email, options }, ok({})); },
    verifyOtp: async (args) => { record('verifyOtp', args); return reply('verifyOtp', args, ok({ session: {} })); },
    updateUser: async (args) => { record('updateUser', args); return reply('updateUser', args, ok({ user: {} })); },
    setSession: async (args) => { record('setSession', args); return ok({ session: {} }); },
    reauthenticate: async () => { record('reauthenticate', {}); return reply('reauthenticate', {}, ok({})); },
    getUser: async () => ({ data: { user: { email: 'amina@exemple.fr' } }, error: null }),
  };
  void fail;
  return { client: { auth }, calls };
}

/** Faux serveur : pseudo libre sauf « taken », et connexion par pseudo renvoyant des jetons seulement. */
function fakeServer({ usernameTaken = [], signInStatus = 200, signInBody = { access_token: 'AT', refresh_token: 'RT' } } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.startsWith('/api/username-available')) {
      const name = new URL(url, 'https://site.test').searchParams.get('username');
      return new Response(JSON.stringify({ available: !usernameTaken.includes(name) }), { status: 200 });
    }
    if (url === '/api/sign-in') return new Response(JSON.stringify(signInBody), { status: signInStatus });
    throw new Error(`appel inattendu : ${url}`);
  };
  return { fetchImpl, requests };
}

const formulaire = {
  username: 'amina_2026', firstName: 'Amina', lastName: 'Koné', email: 'Amina@Exemple.fr',
  countryCode: '+228', localPhone: '90123456', password: 'motdepasse1', passwordConfirmation: 'motdepasse1',
  termsAccepted: true,
};

/* ── Inscription ───────────────────────────────────────────── */

test('inscription : métadonnées complètes, mot de passe jamais dans les métadonnées', async () => {
  const { client, calls } = fakeClient();
  const { fetchImpl } = fakeServer();
  const auth = createAuth({ client, fetchImpl });
  const result = await auth.signUp(formulaire, { termsVersion: '2026-11-18', captchaToken: 'cap-123' });

  const call = calls.find((c) => c.name === 'signUp').args;
  assert.equal(call.email, 'amina@exemple.fr');
  assert.equal(call.password, 'motdepasse1');
  assert.deepEqual(call.options.data, {
    username: 'amina_2026', first_name: 'Amina', last_name: 'Koné', phone: '+22890123456', terms_version: '2026-11-18',
  });
  assert.equal(JSON.stringify(call.options.data).includes('motdepasse1'), false, 'pas de mot de passe dans les métadonnées');
  assert.equal(call.options.captchaToken, 'cap-123');
  assert.match(result.confirmationMessage, /Vérifie ta boîte mail/);
});

test('inscription : formulaire invalide → aucun appel réseau ni au service', async () => {
  const { client, calls } = fakeClient();
  const { fetchImpl, requests } = fakeServer();
  const auth = createAuth({ client, fetchImpl });
  await assert.rejects(
    auth.signUp({ ...formulaire, username: 'a' }, { termsVersion: '2026-11-18' }),
    (err) => err instanceof AuthFlowError && err.code === 'validation' && err.fields.username !== undefined,
  );
  assert.equal(requests.length, 0);
  assert.equal(calls.length, 0);
});

test('inscription : pseudo déjà pris → erreur sur le champ, pas d\'inscription', async () => {
  const { client, calls } = fakeClient();
  const { fetchImpl } = fakeServer({ usernameTaken: ['amina_2026'] });
  const auth = createAuth({ client, fetchImpl });
  await assert.rejects(
    auth.signUp(formulaire, { termsVersion: '2026-11-18' }),
    (err) => err.code === 'username_taken' && err.fields.username === 'Ce pseudo est déjà pris.',
  );
  assert.equal(calls.filter((c) => c.name === 'signUp').length, 0);
});

test('inscription : sans version des CGU connue, refus avant tout appel', async () => {
  const { client, calls } = fakeClient();
  const auth = createAuth({ client, fetchImpl: fakeServer().fetchImpl });
  await assert.rejects(auth.signUp(formulaire, {}), (err) => err.code === 'terms_missing');
  assert.equal(calls.length, 0);
});

test('inscription : erreur du service traduite', async () => {
  const { client } = fakeClient({
    signUp: () => ({ data: null, error: Object.assign(new Error('x'), { code: 'over_email_send_rate_limit' }) }),
  });
  const auth = createAuth({ client, fetchImpl: fakeServer().fetchImpl });
  await assert.rejects(auth.signUp(formulaire, { termsVersion: '2026-11-18' }), /Trop d'e-mails/);
});

/* ── Connexion ─────────────────────────────────────────────── */

test('connexion par e-mail : adresse normalisée, CAPTCHA transmis', async () => {
  const { client, calls } = fakeClient();
  const auth = createAuth({ client, fetchImpl: fakeServer().fetchImpl });
  await auth.signIn({ identifier: ' Amina@Exemple.fr ', password: 'motdepasse1', captchaToken: 'cap-9' });
  const call = calls.find((c) => c.name === 'signInWithPassword').args;
  assert.equal(call.email, 'amina@exemple.fr');
  assert.equal(call.options.captchaToken, 'cap-9');
});

test('connexion par pseudo : passe par le serveur, le navigateur ne reçoit que des jetons', async () => {
  const { client, calls } = fakeClient();
  const { fetchImpl, requests } = fakeServer();
  const auth = createAuth({ client, fetchImpl });
  await auth.signIn({ identifier: 'amina_2026', password: 'motdepasse1' });

  const sent = requests.find((r) => r.url === '/api/sign-in');
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(JSON.parse(sent.init.body), { identifier: 'amina_2026', password: 'motdepasse1' });
  assert.equal(calls.some((c) => c.name === 'signInWithPassword'), false, 'pas de connexion directe pour un pseudo');
  assert.deepEqual(calls.find((c) => c.name === 'setSession').args, { access_token: 'AT', refresh_token: 'RT' });
});

test('connexion par pseudo : identifiants faux → message du serveur, pas de session', async () => {
  const { client, calls } = fakeClient();
  const { fetchImpl } = fakeServer({ signInStatus: 401, signInBody: { error: 'Identifiants incorrects.', code: 'invalid_credentials' } });
  const auth = createAuth({ client, fetchImpl });
  await assert.rejects(auth.signIn({ identifier: 'amina_2026', password: 'faux-mot' }), /Identifiants incorrects/);
  assert.equal(calls.some((c) => c.name === 'setSession'), false);
});

test('connexion : champs vides refusés sans appel', async () => {
  const { client, calls } = fakeClient();
  const auth = createAuth({ client, fetchImpl: fakeServer().fetchImpl });
  await assert.rejects(auth.signIn({ identifier: '', password: 'x' }), /identifiant/);
  assert.equal(calls.length, 0);
});

/* ── Déconnexion et réinitialisation ───────────────────────── */

test('déconnexion : cet appareil uniquement', async () => {
  const { client, calls } = fakeClient();
  await createAuth({ client, fetchImpl: fakeServer().fetchImpl }).signOut();
  assert.deepEqual(calls.find((c) => c.name === 'signOut').args, { scope: 'local' });
});

test('mot de passe oublié : réponse identique que le compte existe ou non', async () => {
  const inconnu = fakeClient({ reset: () => ({ data: null, error: Object.assign(new Error('x'), { code: 'user_not_found' }) }) });
  const connu = fakeClient();
  const a = await createAuth({ client: inconnu.client, fetchImpl: fakeServer().fetchImpl }).requestPasswordReset({ email: 'inconnu@exemple.fr' });
  const b = await createAuth({ client: connu.client, fetchImpl: fakeServer().fetchImpl }).requestPasswordReset({ email: 'connu@exemple.fr' });
  assert.equal(a.confirmationMessage, b.confirmationMessage);
});

test('mot de passe oublié : erreur technique remontée (limite d\'envoi)', async () => {
  const { client } = fakeClient({ reset: () => ({ data: null, error: Object.assign(new Error('x'), { code: 'over_email_send_rate_limit' }) }) });
  await assert.rejects(
    createAuth({ client, fetchImpl: fakeServer().fetchImpl }).requestPasswordReset({ email: 'amina@exemple.fr' }),
    /Trop d'e-mails/,
  );
});

test('confirmation : seuls les types inscription et changement d\'adresse sont acceptés', async () => {
  const { client, calls } = fakeClient();
  const auth = createAuth({ client, fetchImpl: fakeServer().fetchImpl });
  await auth.confirmEmail({ tokenHash: 'a'.repeat(64), type: 'signup' });
  assert.deepEqual(calls.find((c) => c.name === 'verifyOtp').args, { token_hash: 'a'.repeat(64), type: 'signup' });
  await assert.rejects(auth.confirmEmail({ tokenHash: 'a'.repeat(64), type: 'recovery' }), /Lien invalide/);
});

test('réinitialisation : session ouverte avec le type recovery', async () => {
  const { client, calls } = fakeClient();
  await createAuth({ client, fetchImpl: fakeServer().fetchImpl }).openRecoverySession({ tokenHash: 'b'.repeat(64) });
  assert.deepEqual(calls.find((c) => c.name === 'verifyOtp').args, { token_hash: 'b'.repeat(64), type: 'recovery' });
});

test('nouveau mot de passe : validé, puis toutes les sessions fermées', async () => {
  const { client, calls } = fakeClient();
  const auth = createAuth({ client, fetchImpl: fakeServer().fetchImpl });
  await assert.rejects(auth.setNewPassword({ password: 'court', confirmation: 'court', email: 'a@exemple.fr' }), /au moins 10/);
  assert.equal(calls.length, 0, 'rien n\'est envoyé si le mot de passe est faible');
  await auth.setNewPassword({ password: 'nouveaumotdepasse', confirmation: 'nouveaumotdepasse', email: 'a@exemple.fr' });
  assert.deepEqual(calls.find((c) => c.name === 'updateUser').args, { password: 'nouveaumotdepasse' });
  assert.deepEqual(calls.find((c) => c.name === 'signOut').args, { scope: 'global' });
});

/* ── Réglages du compte ────────────────────────────────────── */

test('changement de mot de passe : ancien mot de passe vérifié, autres sessions fermées', async () => {
  const { client, calls } = fakeClient();
  await createAuth({ client, fetchImpl: fakeServer().fetchImpl }).changePassword({
    email: 'amina@exemple.fr', currentPassword: 'ancienmotdepasse', newPassword: 'nouveaumotdepasse', confirmation: 'nouveaumotdepasse',
  });
  const names = calls.map((c) => c.name);
  assert.deepEqual(names, ['signInWithPassword', 'updateUser', 'signOut']);
  assert.deepEqual(calls[0].args, { email: 'amina@exemple.fr', password: 'ancienmotdepasse' });
  assert.deepEqual(calls[2].args, { scope: 'others' });
});

test('changement de mot de passe : mauvais ancien mot de passe → aucune modification', async () => {
  const { client, calls } = fakeClient({
    signInWithPassword: () => ({ data: null, error: Object.assign(new Error('x'), { code: 'invalid_credentials' }) }),
  });
  await assert.rejects(
    createAuth({ client, fetchImpl: fakeServer().fetchImpl }).changePassword({
      email: 'amina@exemple.fr', currentPassword: 'faux', newPassword: 'nouveaumotdepasse', confirmation: 'nouveaumotdepasse',
    }),
    (err) => err.fields?.currentPassword !== undefined,
  );
  assert.equal(calls.some((c) => c.name === 'updateUser'), false);
});

test('reconfirmation par code : le code part avec la modification, sans nouvelle vérification de l\'ancien mot de passe', async () => {
  const { client, calls } = fakeClient();
  await createAuth({ client, fetchImpl: fakeServer().fetchImpl }).changePassword({
    email: 'amina@exemple.fr', newPassword: 'nouveaumotdepasse', confirmation: 'nouveaumotdepasse', nonce: '482913',
  });
  assert.equal(calls.some((c) => c.name === 'signInWithPassword'), false);
  assert.deepEqual(calls.find((c) => c.name === 'updateUser').args, { password: 'nouveaumotdepasse', nonce: '482913' });
});

test('reconfirmation : demande du code par e-mail', async () => {
  const { client, calls } = fakeClient();
  const r = await createAuth({ client, fetchImpl: fakeServer().fetchImpl }).requestReauthentication();
  assert.equal(calls.some((c) => c.name === 'reauthenticate'), true);
  assert.match(r.confirmationMessage, /code de confirmation/);
});

test('changement d\'adresse : validation puis demande au service (les deux adresses seront prévenues)', async () => {
  const { client, calls } = fakeClient();
  const auth = createAuth({ client, fetchImpl: fakeServer().fetchImpl });
  await assert.rejects(auth.changeEmail({ newEmail: 'pas-une-adresse' }), /invalide/);
  assert.equal(calls.length, 0);
  await auth.changeEmail({ newEmail: 'Nouvelle@Exemple.fr' });
  assert.deepEqual(calls.find((c) => c.name === 'updateUser').args, { email: 'nouvelle@exemple.fr' });
});
