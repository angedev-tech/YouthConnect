// Connexion par pseudo (migration 6) : résolution réservée au serveur, sans casse, comptes actifs seulement.
import pg from 'pg';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { Client } = pg;
const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error('TEST_DATABASE_URL manquant : lance les tests avec « npm run test:db ».');

const c = new Client({ connectionString: URL });
const ID_ACTIF = '66666666-6666-4666-8666-666666666666';
const ID_SUSPENDU = '77777777-7777-4777-8777-777777777777';

before(async () => {
  await c.connect();
  const comptes = [
    [ID_ACTIF, 'lina@exemple.fr', '+22899880001', 'lina_togo'],
    [ID_SUSPENDU, 'marc@exemple.fr', '+22899880002', 'marc_suspendu'],
  ];
  for (const [id, email, phone, username] of comptes) {
    await c.query(
      'insert into auth.users (id, email, phone, raw_user_meta_data, email_confirmed_at, phone_confirmed_at) values ($1, $2, $3, $4::jsonb, now(), now())',
      [id, email, phone, JSON.stringify({ username, first_name: 'Test', last_name: 'Login', terms_version: '2026-11-18', birth_date: '1990-05-12' })],
    );
  }
  // Suspension de test : on contourne les déclencheurs (ce test ne vérifie pas la modération)
  await c.query('set session_replication_role = replica');
  await c.query("update public.profiles set status = 'suspended' where id = $1", [ID_SUSPENDU]);
  await c.query('set session_replication_role = origin');
});

after(async () => {
  await c.end();
});

const resolve = (candidate) => c.query('select public.resolve_login_email($1) as email', [candidate]);

test('le serveur retrouve l\'adresse d\'un pseudo actif, sans tenir compte de la casse', async () => {
  await c.query('reset role');
  await c.query('set role service_role');
  assert.equal((await resolve('lina_togo')).rows[0].email, 'lina@exemple.fr');
  assert.equal((await resolve('LINA_TOGO')).rows[0].email, 'lina@exemple.fr');
  await c.query('reset role');
});

test('un compte suspendu n\'est jamais résolu', async () => {
  await c.query('reset role');
  await c.query('set role service_role');
  assert.equal((await resolve('marc_suspendu')).rows[0].email, null);
  await c.query('reset role');
});

test('pseudo inconnu : aucune adresse', async () => {
  await c.query('reset role');
  await c.query('set role service_role');
  assert.equal((await resolve('personne_xyz')).rows[0].email, null);
  assert.equal((await resolve(null)).rows[0].email, null);
  await c.query('reset role');
});

test('le visiteur et le membre ne peuvent pas appeler la résolution', async () => {
  await c.query('reset role');
  await c.query('set role anon');
  await assert.rejects(resolve('lina_togo'), /permission denied/);
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claims', '{\"sub\":\"66666666-6666-4666-8666-666666666666\",\"role\":\"authenticated\"}', false)");
  await c.query('set role authenticated');
  await assert.rejects(resolve('lina_togo'), /permission denied/);
  await c.query('reset role');
});
