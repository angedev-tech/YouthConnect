// Décisions du 19 novembre 2026 : 18 ans, e-mail et téléphone vérifiés, Google, push, anciens contenus.
import pg from 'pg';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { Client } = pg;
const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error('TEST_DATABASE_URL manquant : lance les tests avec « npm run test:db ».');

const c = new Client({ connectionString: URL });
// Identifiants propres à ce fichier : les fichiers de test s'exécutent en parallèle
const U = {
  bob: '88888888-8888-4888-8888-888888888888',
  eve: '99999999-9999-4999-8999-999999999999',
};
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERIFIE_SQL = "insert into auth.users (id, email, phone, raw_user_meta_data, email_confirmed_at, phone_confirmed_at) values ($1,$2,$3,$4::jsonb,now(),now())";
const F = {};
let ETUDES = null;
let seq = 0;

const SIGNUP = 'insert into auth.users (id, email, phone, raw_user_meta_data) values ($1, $2, $3, $4::jsonb)';

function nouvelUtilisateur(meta = {}) {
  seq += 1;
  return {
    id: `00000000-0000-4000-8100-${String(seq).padStart(12, '0')}`,
    email: `decision${seq}@test.local`,
    phone: `+22898${String(700000 + seq)}`,
    meta: {
      username: `decision_${seq}`,
      first_name: 'Décision',
      last_name: 'Test',
      terms_version: '2026-11-18',
      birth_date: '1990-05-12',
      ...meta,
    },
  };
}
const params = (u) => [u.id, u.email, u.phone, JSON.stringify(u.meta)];

async function tx(fn) {
  await c.query('begin');
  try {
    await fn();
  } finally {
    await c.query('rollback');
  }
}
const superuser = () => c.query('reset role');
async function as(who) {
  await c.query('reset role');
  if (who === 'anon') {
    await c.query("select set_config('request.jwt.claims', '', true)");
    await c.query('set local role anon');
    return;
  }
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: 'authenticated' })]);
  await c.query('set local role authenticated');
}
const sql = (text, p = []) => c.query(text, p);
const count = async (text, p = []) => Number((await c.query(text, p)).rows[0].n);
// Nombre d'appareils visibles pour l'identité courante (la politique RLS limite aux siens)
const nombreAbonnements = async () => (await c.query('select id from push_subscriptions')).rowCount;

async function failure(text, p, pattern) {
  await c.query('savepoint probe');
  try {
    await c.query(text, p);
  } catch (err) {
    await c.query('rollback to savepoint probe');
    assert.match(err.message, pattern);
    return err;
  }
  assert.fail(`la requête aurait dû être refusée : ${text.slice(0, 90)}`);
}

// Date de naissance calculée par la base elle-même (même horloge que les règles)
async function dateAgo(years, days = 0) {
  const r = await c.query(`select ((current_date - interval '${years} years') + interval '${days} days')::date::text as d`);
  return r.rows[0].d;
}

/** Vérifie l'e-mail et le téléphone d'un compte (rôle superutilisateur, comme Supabase Auth). */
async function verifierCompte(id, phone) {
  await superuser();
  await sql('update auth.users set email_confirmed_at = now() where id = $1', [id]);
  await sql('update auth.users set phone = $2, phone_confirmed_at = now() where id = $1', [id, phone]);
}

before(async () => {
  await c.connect();
  ETUDES = (await c.query("select id from categories where slug = 'etudes'")).rows[0].id;
  // Compte de départ vérifié, pour les tests qui ont besoin d'un auteur actif
  const verifie = (username, first, id, email, phone) => c.query(
    "insert into auth.users (id, email, phone, raw_user_meta_data, email_confirmed_at, phone_confirmed_at) values ($1,$2,$3,$4::jsonb,now(),now())",
    [id, email, phone, JSON.stringify({ username, first_name: first, last_name: 'Test', terms_version: '2026-11-18', birth_date: '1990-05-12' })],
  );
  await verifie('decision_bob', 'Bob', U.bob, 'decision-bob@test.local', '+22891000001');
  await verifie('decision_eve', 'Eve', U.eve, 'decision-eve@test.local', '+22891000002');
  // Pas d'administrateur committé ici : il ferait échouer les tests « dernier administrateur » du fichier rls
  const q = await c.query(
    'insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4) returning id',
    [U.bob, ETUDES, 'Question de départ pour les décisions', 'Contenu suffisamment long pour passer la règle de longueur.'],
  );
  F.Q1 = q.rows[0].id;
});

after(async () => {
  await c.end();
});

/* ══════════════════ D1 — Âge minimum 18 ans ══════════════════ */

test('D1 : 18 ans révolus acceptés ; la veille des 18 ans refusée', () => tx(async () => {
  const exact = nouvelUtilisateur({ birth_date: await dateAgo(18) });
  await sql(SIGNUP, params(exact));
  assert.equal(await count('select count(*)::int as n from profiles where id = $1', [exact.id]), 1);

  const veille = nouvelUtilisateur({ birth_date: await dateAgo(18, 1) });
  await failure(SIGNUP, params(veille), /18 ans ou plus/);
}));

test('D1 : moins de 18 ans → inscription refusée, aucune donnée enregistrée', () => tx(async () => {
  const mineur = nouvelUtilisateur({ birth_date: await dateAgo(17) });
  await failure(SIGNUP, params(mineur), /18 ans ou plus/);
  assert.equal(await count('select count(*)::int as n from auth.users where id = $1', [mineur.id]), 0);
}));

test('D1 : date de naissance absente ou impossible → refusée', () => tx(async () => {
  await failure(SIGNUP, params(nouvelUtilisateur({ birth_date: undefined })), /date de naissance est obligatoire/);
  await failure(SIGNUP, params(nouvelUtilisateur({ birth_date: '1990/05/12' })), /date de naissance est obligatoire/);
  await failure(SIGNUP, params(nouvelUtilisateur({ birth_date: '1990-02-31' })), /Date de naissance invalide/);
}));

/* ══════════════════ D3 — E-mail ET téléphone vérifiés ══════════════════ */

test('D3 : e-mail confirmé seul → toujours en attente', () => tx(async () => {
  const u = nouvelUtilisateur();
  await sql(SIGNUP, params(u));
  await superuser();
  await sql('update auth.users set email_confirmed_at = now() where id = $1', [u.id]);
  assert.equal((await sql('select status from profiles where id = $1', [u.id])).rows[0].status, 'pending');
}));

test('D3 : téléphone vérifié seul → toujours en attente', () => tx(async () => {
  const u = nouvelUtilisateur();
  await sql(SIGNUP, params(u));
  await superuser();
  await sql('update auth.users set phone = $2, phone_confirmed_at = now() where id = $1', [u.id, u.phone]);
  assert.equal((await sql('select status from profiles where id = $1', [u.id])).rows[0].status, 'pending');
  // Le numéro vérifié est recopié dans le profil privé
  const d = await sql('select phone_verified_at from account_details where user_id = $1', [u.id]);
  assert.notEqual(d.rows[0].phone_verified_at, null);
}));

test('D3 : e-mail ET téléphone vérifiés → compte actif, qui peut publier', () => tx(async () => {
  const u = nouvelUtilisateur();
  await sql(SIGNUP, params(u));
  await verifierCompte(u.id, u.phone);
  assert.equal((await sql('select status from profiles where id = $1', [u.id])).rows[0].status, 'active');

  await as(u.id);
  const r = await sql('insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4) returning id',
    [u.id, ETUDES, 'Question après vérification', 'Contenu suffisamment long pour passer la règle de longueur.']);
  assert.ok(r.rows[0].id);
}));

test('D3 : un compte en attente ne peut rien publier', () => tx(async () => {
  const u = nouvelUtilisateur();
  await sql(SIGNUP, params(u));
  await as(u.id);
  await failure('insert into questions (user_id, category_id, title, content) values ($1, $2, $3, $4)',
    [u.id, ETUDES, 'Question avant vérification', 'Contenu suffisamment long pour passer la règle de longueur.'],
    /row-level security/);
}));

test('D3 : changer de numéro sans le vérifier fait repasser le compte en attente', () => tx(async () => {
  const u = nouvelUtilisateur();
  await sql(SIGNUP, params(u));
  await verifierCompte(u.id, u.phone);
  assert.equal((await sql('select status from profiles where id = $1', [u.id])).rows[0].status, 'active');

  await superuser();
  await sql('update auth.users set phone = $2, phone_confirmed_at = null where id = $1', [u.id, '+22898123456']);
  assert.equal((await sql('select status from profiles where id = $1', [u.id])).rows[0].status, 'pending');
}));

test('D3 : un membre ne peut pas se déclarer vérifié ni changer sa date de naissance', () => tx(async () => {
  await as(U.bob);
  await failure('update account_details set phone_verified_at = now() where user_id = $1', [U.bob], /permission denied/);
  await failure('update account_details set birth_date = $2 where user_id = $1', [U.bob, '2000-01-01'], /permission denied/);
  await failure('update profiles set status = $2 where id = $1', [U.bob, 'active'], /permission denied/);
}));

/* ══════════════════ D2 — Connexion Google et complétion du profil ══════════════════ */

async function creerCompteGoogle() {
  seq += 1;
  const id = `00000000-0000-4000-8200-${String(seq).padStart(12, '0')}`;
  await superuser();
  await sql(
    "insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values ($1, $2, '{\"provider\":\"google\"}'::jsonb, '{\"given_name\":\"Ama\",\"family_name\":\"Test\"}'::jsonb, now())",
    [id, `google${seq}@test.local`],
  );
  return id;
}

test('D2 : compte Google créé en attente, avec un pseudo provisoire, sans date ni téléphone inventés', () => tx(async () => {
  const id = await creerCompteGoogle();
  const p = await sql('select username, username_chosen_at, status from profiles where id = $1', [id]);
  assert.match(p.rows[0].username, /^membre_[0-9a-f]{12}$/);
  assert.equal(p.rows[0].username_chosen_at, null);
  assert.equal(p.rows[0].status, 'pending');
  const d = await sql('select birth_date, phone, first_name from account_details where user_id = $1', [id]);
  assert.equal(d.rows[0].birth_date, null);
  assert.equal(d.rows[0].phone, null);
  assert.equal(d.rows[0].first_name, 'Ama');
}));

test('D2 : complétion refusée pour un mineur, et rien n\'est enregistré', () => tx(async () => {
  const id = await creerCompteGoogle();
  await as(id);
  const mineur = await dateAgo(17);
  await failure('select public.complete_onboarding($1, $2, $3)', ['ama_mineure', mineur, '2026-11-18'], /18 ans ou plus/);
  await superuser();
  const p = await sql('select username_chosen_at from profiles where id = $1', [id]);
  assert.equal(p.rows[0].username_chosen_at, null, 'le pseudo n\'est pas choisi');
  const d = await sql('select birth_date from account_details where user_id = $1', [id]);
  assert.equal(d.rows[0].birth_date, null, 'la date du mineur n\'est jamais enregistrée');
}));

test('D2 : complétion adulte puis téléphone vérifié → compte actif', () => tx(async () => {
  const id = await creerCompteGoogle();
  await as(id);
  await sql('select public.complete_onboarding($1, $2, $3)', ['ama_google', await dateAgo(25), '2026-11-18']);
  await superuser();
  assert.equal((await sql('select status from profiles where id = $1', [id])).rows[0].status, 'pending', 'pas encore : téléphone manquant');
  await sql('update auth.users set phone = $2, phone_confirmed_at = now() where id = $1', [id, '+22897654321']);
  assert.equal((await sql('select status from profiles where id = $1', [id])).rows[0].status, 'active');
}));

test('D2 : complétion avec des conditions périmées ou un pseudo déjà pris → refusée', () => tx(async () => {
  const id = await creerCompteGoogle();
  await as(id);
  await failure('select public.complete_onboarding($1, $2, $3)', ['ama_google', await dateAgo(25), '2020-01-01'], /version actuelle/);
  await failure('select public.complete_onboarding($1, $2, $3)', ['decision_bob', await dateAgo(25), '2026-11-18'], /déjà pris/);
}));

test('D2 : un visiteur ne peut pas compléter de profil', () => tx(async () => {
  await as('anon');
  await failure('select public.complete_onboarding($1, $2, $3)', ['intrus_visiteur', await dateAgo(25), '2026-11-18'], /permission denied/);
}));

/* ══════════════════ Réactivation : aucun contournement ══════════════════ */

async function creerAdministrateur() {
  await superuser();
  await sql(VERIFIE_SQL, [ADMIN, 'decision-admin@test.local', '+22891000003', JSON.stringify({ username: 'decision_admin', first_name: 'Admin', last_name: 'Test', terms_version: '2026-11-18', birth_date: '1990-05-12' })]);
  await sql('insert into user_roles (user_id, role_id) values ($1, 3)', [ADMIN]);
}

test('la réactivation par un administrateur ne contourne pas la vérification', () => tx(async () => {
  await creerAdministrateur();
  const u = nouvelUtilisateur();
  await sql(SIGNUP, params(u));                       // compte en attente : rien n'est vérifié
  await as(ADMIN);
  await sql('select public.admin_set_account_status($1, $2, $3)', [u.id, 'suspended', 'test']);
  await sql('select public.admin_set_account_status($1, $2, $3)', [u.id, 'active', 'test']);
  await superuser();
  assert.equal((await sql('select status from profiles where id = $1', [u.id])).rows[0].status, 'pending');
}));

/* ══════════════════ D7 — Anciens contenus : « ancien membre » ══════════════════ */

test('D7 : un ancien contenu n\'a pas d\'auteur, est marqué et visible du public', () => tx(async () => {
  await superuser();
  await sql(
    "insert into questions (user_id, category_id, title, content, is_legacy, legacy_source_id) values (null, $1, $2, $3, true, 'fs_legacy_001')",
    [ETUDES, 'Ancienne publication migrée', 'Contenu ancien suffisamment long pour être valide.'],
  );
  await as('anon');
  const r = await sql("select user_id, is_legacy from questions where legacy_source_id = 'fs_legacy_001'");
  assert.equal(r.rows[0].user_id, null);
  assert.equal(r.rows[0].is_legacy, true);
}));

test('D7 : un contenu ancien ne peut pas être lié à un compte', () => tx(async () => {
  await superuser();
  await failure(
    "insert into questions (user_id, category_id, title, content, is_legacy) values ($1, $2, $3, $4, true)",
    [U.bob, ETUDES, 'Ancien relié à un compte', 'Contenu suffisamment long pour passer la règle.'],
    /questions_legacy_unlinked/,
  );
}));

test('D7 : un membre ne peut ni marquer un contenu comme ancien ni le rattacher', () => tx(async () => {
  await as(U.bob);
  await failure(
    'insert into questions (user_id, category_id, title, content, is_legacy) values ($1, $2, $3, $4, true)',
    [U.bob, ETUDES, 'Tentative de marquage', 'Contenu suffisamment long pour passer la règle.'],
    /permission denied/,
  );
}));

/* ══════════════════ D4 — Notifications push ══════════════════ */

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/appareil-bob-1';
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const AUTH = 'tBHItJI5svbpez7KI4CCXg';

test('D4 : seul un membre actif enregistre un appareil ; adresses non sûres refusées', () => tx(async () => {
  const pending = nouvelUtilisateur();
  await sql(SIGNUP, params(pending));
  await as(pending.id);
  await failure('select public.register_push_subscription($1, $2, $3)', [ENDPOINT, P256DH, AUTH], /non actif/);

  await as(U.bob);
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/x',
    'https://203.0.113.9/push',
    'https://localhost/push',
    'https://service.internal/push',
    'https://fcm.googleapis.com:8443/push',
    'https://sansdomaine/push',
  ]) {
    await failure('select public.register_push_subscription($1, $2, $3)', [bad, P256DH, AUTH], /Abonnement invalide/);
  }
  await failure('select public.register_push_subscription($1, $2, $3)', [ENDPOINT, '<script>', AUTH], /Abonnement invalide/);
  await sql('select public.register_push_subscription($1, $2, $3)', [ENDPOINT, P256DH, AUTH]);
  assert.equal(await nombreAbonnements(), 1);
}));

test('D4 : un même appareil ne compte qu\'une fois ; 10 appareils maximum', () => tx(async () => {
  await as(U.bob);
  await sql('select public.register_push_subscription($1, $2, $3)', [ENDPOINT, P256DH, AUTH]);
  await sql('select public.register_push_subscription($1, $2, $3)', [ENDPOINT, P256DH, AUTH]);
  assert.equal(await nombreAbonnements(), 1);
  for (let i = 2; i <= 10; i++) {
    await sql('select public.register_push_subscription($1, $2, $3)', [`https://fcm.googleapis.com/fcm/send/appareil-bob-${i}`, P256DH, AUTH]);
  }
  await failure('select public.register_push_subscription($1, $2, $3)', ['https://fcm.googleapis.com/fcm/send/appareil-bob-11', P256DH, AUTH], /10 maximum/);
}));

test('D4 : l\'adresse secrète et les clés ne sont jamais lisibles par le membre', () => tx(async () => {
  await as(U.bob);
  await sql('select public.register_push_subscription($1, $2, $3)', [ENDPOINT, P256DH, AUTH]);
  await failure('select endpoint from push_subscriptions', [], /permission denied/);
  await failure('select auth_secret from push_subscriptions', [], /permission denied/);
  const mine = await sql('select id, created_at from push_subscriptions');
  assert.ok(mine.rowCount >= 1);
}));

test('D4 : un appareil repris par un autre compte appartient désormais à ce compte', () => tx(async () => {
  await as(U.bob);
  await sql('select public.register_push_subscription($1, $2, $3)', [ENDPOINT, P256DH, AUTH]);
  await as(U.eve);
  await sql('select public.register_push_subscription($1, $2, $3)', [ENDPOINT, P256DH, AUTH]);
  await superuser();
  const r = await sql('select user_id from push_subscriptions where endpoint = $1', [ENDPOINT]);
  assert.equal(r.rows[0].user_id, U.eve);
}));

test('D4 : désabonnement : seulement son propre appareil', () => tx(async () => {
  await as(U.bob);
  await sql('select public.register_push_subscription($1, $2, $3)', [ENDPOINT, P256DH, AUTH]);
  await as(U.eve);
  await sql('select public.remove_push_subscription($1)', [ENDPOINT]);
  await superuser();
  assert.equal(await count('select count(*)::int as n from push_subscriptions where endpoint = $1', [ENDPOINT]), 1, 'l\'appareil de Bob n\'est pas retiré par Eve');
  await as(U.bob);
  await sql('select public.remove_push_subscription($1)', [ENDPOINT]);
  await superuser();
  assert.equal(await count('select count(*)::int as n from push_subscriptions where endpoint = $1', [ENDPOINT]), 0);
}));

test('D4 : préférences de notification : ses propres choix seulement, aucun réglage pour les alertes de sécurité', () => tx(async () => {
  await as(U.bob);
  await sql('insert into notification_preferences (user_id, answers) values ($1, false)', [U.bob]);
  await as(U.eve);
  assert.equal((await sql('update notification_preferences set answers = true where user_id = $1', [U.bob])).rowCount, 0);
  await as(U.bob);
  await failure('update notification_preferences set user_id = $1 where user_id = $2', [U.eve, U.bob], /permission denied/);
  await superuser();
  const colonnes = await sql("select column_name from information_schema.columns where table_name = 'notification_preferences'");
  assert.ok(!colonnes.rows.some((r) => /security|securit/i.test(r.column_name)), 'aucune colonne ne désactive les alertes de sécurité');
}));
