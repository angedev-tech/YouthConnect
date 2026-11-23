// Dédoublonnage des SMS (migration 8) : un appel du hook ne produit qu'un SMS.
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

async function clientAs(role) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  clients.push(c);
  if (role === 'anon') {
    await c.query('set role anon');
  } else if (role === 'authenticated') {
    await c.query("select set_config('request.jwt.claims', '{\"sub\":\"11111111-1111-4111-8111-111111111111\",\"role\":\"authenticated\"}', false)");
    await c.query('set role authenticated');
  } else {
    await c.query('set role service_role');
  }
  return c;
}

test('premier appel accepté, second appel avec le même identifiant refusé', async () => {
  const c = await clientAs('service');
  assert.equal((await c.query('select public.claim_sms_delivery($1) as ok', ['msg_a1'])).rows[0].ok, true);
  assert.equal((await c.query('select public.claim_sms_delivery($1) as ok', ['msg_a1'])).rows[0].ok, false);
  assert.equal((await c.query('select public.claim_sms_delivery($1) as ok', ['msg_a2'])).rows[0].ok, true, 'un autre identifiant est indépendant');
});

test('après un échec, la trace est retirée et un nouvel essai est possible', async () => {
  const c = await clientAs('service');
  await c.query('select public.claim_sms_delivery($1)', ['msg_b1']);
  await c.query('select public.release_sms_delivery($1)', ['msg_b1']);
  assert.equal((await c.query('select public.claim_sms_delivery($1) as ok', ['msg_b1'])).rows[0].ok, true);
});

test('identifiant vide ou trop long refusé', async () => {
  const c = await clientAs('service');
  await assert.rejects(c.query('select public.claim_sms_delivery($1)', ['']), /Identifiant invalide/);
  await assert.rejects(c.query('select public.claim_sms_delivery($1)', ['x'.repeat(201)]), /Identifiant invalide/);
});

test('le visiteur et le membre ne peuvent ni lire la table ni appeler les fonctions', async () => {
  for (const role of ['anon', 'authenticated']) {
    const c = await clientAs(role);
    await assert.rejects(c.query('select * from public.sms_deliveries'), /permission denied/, role);
    await assert.rejects(c.query('select public.claim_sms_delivery($1)', ['msg_x']), /permission denied/, role);
    await assert.rejects(c.query('select public.release_sms_delivery($1)', ['msg_x']), /permission denied/, role);
  }
});

test('purge : supprime les traces de plus de 7 jours, garde les récentes', async () => {
  await admin.query(
    "insert into public.sms_deliveries (id, created_at) values ('msg_ancien', now() - interval '8 days'), ('msg_recent', now() - interval '1 day') on conflict (id) do nothing",
  );
  const removed = await admin.query('select public.purge_sms_deliveries() as n');
  assert.ok(Number(removed.rows[0].n) >= 1);
  const restants = await admin.query("select id from public.sms_deliveries where id in ('msg_ancien', 'msg_recent')");
  assert.deepEqual(restants.rows.map((r) => r.id), ['msg_recent']);
});
