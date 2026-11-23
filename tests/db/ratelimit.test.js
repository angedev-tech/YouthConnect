// Tests de la limitation de débit (migration 5). Lancés par « npm run test:db ».

import pg from 'pg';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { Client } = pg;
const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error('TEST_DATABASE_URL manquant : lance les tests avec « npm run test:db ».');

const admin = new Client({ connectionString: URL });
const clients = [];

before(async () => {
  await admin.connect();
});

after(async () => {
  await Promise.all([admin.end(), ...clients.map((c) => c.end())]);
});

const consume = (client, key, limit, windowSeconds = 60) =>
  client.query('select public.consume_rate_limit($1, $2, $3) as ok', [key, limit, windowSeconds]);

test('autorise jusqu\'à la limite, puis refuse', async () => {
  const key = 'test:limite';
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await consume(admin, key, 3)).rows[0].ok);
  assert.deepEqual(results, [true, true, true, false]);
});

test('une fois la fenêtre écoulée, le compteur repart de zéro', async () => {
  const key = 'test:fenetre';
  for (let i = 0; i < 2; i++) await consume(admin, key, 2);
  assert.equal((await consume(admin, key, 2)).rows[0].ok, false);

  // On recule l'ouverture de la fenêtre au-delà de sa durée
  await admin.query(
    "update public.rate_limits set window_started_at = now() - interval '2 minutes' where key = $1",
    [key],
  );
  assert.equal((await consume(admin, key, 2)).rows[0].ok, true);
});

test('les clés sont indépendantes', async () => {
  for (let i = 0; i < 2; i++) await consume(admin, 'test:cle-a', 2);
  assert.equal((await consume(admin, 'test:cle-a', 2)).rows[0].ok, false);
  assert.equal((await consume(admin, 'test:cle-b', 2)).rows[0].ok, true);
});

test('appels simultanés : exactement la limite est accordée (incrément atomique)', async () => {
  const key = 'test:simultane';
  const pool = [];
  for (let i = 0; i < 10; i++) {
    const c = new Client({ connectionString: URL });
    await c.connect();
    clients.push(c);
    pool.push(c);
  }
  const outcomes = await Promise.all(pool.map((c) => consume(c, key, 5).then((r) => r.rows[0].ok)));
  assert.equal(outcomes.filter(Boolean).length, 5, `résultats : ${JSON.stringify(outcomes)}`);
});

test('paramètres invalides refusés', async () => {
  await assert.rejects(consume(admin, '', 3), /Paramètres de limitation invalides/);
  await assert.rejects(consume(admin, 'k', 0), /Paramètres de limitation invalides/);
  await assert.rejects(consume(admin, 'k', 3, 0), /Paramètres de limitation invalides/);
});

test('le visiteur et le membre ne peuvent ni lire ni appeler les compteurs', async () => {
  const c = new Client({ connectionString: URL });
  await c.connect();
  clients.push(c);
  await c.query('set role anon');
  await assert.rejects(c.query('select * from public.rate_limits'), /permission denied/);
  await assert.rejects(consume(c, 'k', 3), /permission denied/);
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claims', '{\"sub\":\"11111111-1111-4111-8111-111111111111\",\"role\":\"authenticated\"}', false)");
  await c.query('set role authenticated');
  await assert.rejects(c.query('select * from public.rate_limits'), /permission denied/);
  await assert.rejects(consume(c, 'k', 3), /permission denied/);
  await c.query('reset role');
});

test('le serveur (service_role) peut appeler la fonction', async () => {
  const c = new Client({ connectionString: URL });
  await c.connect();
  clients.push(c);
  await c.query('set role service_role');
  assert.equal((await consume(c, 'test:serveur', 1)).rows[0].ok, true);
  await c.query('reset role');
});

test('purge : supprime les compteurs de plus de 24 h seulement', async () => {
  await consume(admin, 'test:ancien', 5);
  await consume(admin, 'test:recent', 5);
  await admin.query(
    "update public.rate_limits set window_started_at = now() - interval '3 days' where key = 'test:ancien'",
  );
  const removed = await admin.query('select public.purge_rate_limits() as n');
  assert.ok(Number(removed.rows[0].n) >= 1);
  const remaining = await admin.query("select key from public.rate_limits where key in ('test:ancien', 'test:recent')");
  assert.deepEqual(remaining.rows.map((r) => r.key), ['test:recent']);
});
