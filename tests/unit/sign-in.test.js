import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import signIn from '../../api/sign-in.js';

const URL_PROJET = 'https://abcdefgh.supabase.co';
const PUBLISHABLE = 'sb_publishable_ABCDEFGH12345678';
const SECRET = 'sb_secret_ZYXWVUTS87654321';
const EMAIL = 'amina@exemple.fr';
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'IP_HASH_SECRET', 'VERCEL_ENV'];

let saved; let originalFetch; let originalConsole; let logs; let calls; let scenario;

function fakeSupabase(overrides = {}) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.includes('/rpc/consume_rate_limit')) {
      return new Response(JSON.stringify(overrides.limit ?? true), { status: 200 });
    }
    if (u.includes('/rpc/resolve_login_email')) {
      const body = JSON.parse(init.body);
      const found = body.candidate === 'amina_2026' ? EMAIL : null;
      return new Response(JSON.stringify(overrides.resolve === undefined ? found : overrides.resolve), { status: 200 });
    }
    if (u.includes('/auth/v1/token')) {
      const body = JSON.parse(init.body);
      if (overrides.tokenError) return new Response(JSON.stringify(overrides.tokenError.body), { status: overrides.tokenError.status });
      if (body.email === EMAIL && body.password === 'motdepasse1') {
        return new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, token_type: 'bearer', user: { email: EMAIL } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }), { status: 400 });
    }
    throw new Error(`appel inattendu : ${u}`);
  };
}

const post = (body, headers = {}) => new Request('https://site.test/api/sign-in', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '203.0.113.9', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    SUPABASE_URL: URL_PROJET, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SUPABASE_SECRET_KEY: SECRET,
    IP_HASH_SECRET: 'x'.repeat(40), VERCEL_ENV: 'preview',
  });
  calls = []; scenario = {};
  originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => fakeSupabase(scenario)(url, init);
  logs = [];
  originalConsole = { error: console.error, warn: console.warn, info: console.info };
  for (const level of ['error', 'warn', 'info']) console[level] = (...a) => logs.push(a.join(' '));
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = originalFetch;
  Object.assign(console, originalConsole);
});

const tokenCalls = () => calls.filter((c) => c.url.includes('/auth/v1/token'));

test('connexion par pseudo : jetons renvoyés, adresse e-mail jamais renvoyée', async () => {
  const res = await signIn.fetch(post({ identifier: 'amina_2026', password: 'motdepasse1' }));
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.access_token, 'AT');
  assert.equal(body.refresh_token, 'RT');
  assert.equal(text.includes(EMAIL), false, 'l\'adresse n\'apparaît nulle part dans la réponse');
  assert.equal(text.includes('user'), false);
});

test('clés : la recherche du pseudo utilise la clé secrète, la connexion la clé publiable', async () => {
  await signIn.fetch(post({ identifier: 'amina_2026', password: 'motdepasse1' }));
  const rpc = calls.find((c) => c.url.includes('/rpc/resolve_login_email'));
  assert.equal(rpc.init.headers.apikey, SECRET);
  const token = tokenCalls()[0];
  assert.equal(token.init.headers.apikey, PUBLISHABLE, 'jamais la clé secrète vers l\'authentification');
  assert.equal(token.init.headers.Authorization, undefined);
});

test('connexion par e-mail : pas de recherche de pseudo', async () => {
  const res = await signIn.fetch(post({ identifier: EMAIL, password: 'motdepasse1' }));
  assert.equal(res.status, 200);
  assert.equal(calls.some((c) => c.url.includes('resolve_login_email')), false);
});

test('mauvais mot de passe et pseudo inconnu : réponses strictement identiques', async () => {
  const mauvais = await signIn.fetch(post({ identifier: 'amina_2026', password: 'faux-mot-de-passe' }));
  const inconnu = await signIn.fetch(post({ identifier: 'personne_xyz', password: 'faux-mot-de-passe' }));
  assert.equal(mauvais.status, 401);
  assert.equal(inconnu.status, 401);
  assert.equal(await mauvais.text(), await inconnu.text(), 'aucune révélation de l\'existence d\'un pseudo');
  assert.equal(tokenCalls().length, 1, 'pour un pseudo inconnu, aucun appel d\'authentification');
});

test('e-mail non confirmé : code transmis pour afficher le bon message', async () => {
  scenario = { tokenError: { status: 400, body: { error_code: 'email_not_confirmed', msg: 'x' } } };
  const res = await signIn.fetch(post({ identifier: EMAIL, password: 'motdepasse1' }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'email_not_confirmed');
});

test('CAPTCHA : le jeton est transmis à l\'authentification ; échec → 400 explicite', async () => {
  await signIn.fetch(post({ identifier: EMAIL, password: 'motdepasse1', captchaToken: 'cap-abc' }));
  assert.deepEqual(JSON.parse(tokenCalls()[0].init.body).gotrue_meta_security, { captcha_token: 'cap-abc' });

  scenario = { tokenError: { status: 400, body: { error_code: 'captcha_failed', msg: 'x' } } };
  const res = await signIn.fetch(post({ identifier: EMAIL, password: 'motdepasse1', captchaToken: 'mauvais' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'captcha_failed');
});

test('limite par identifiant : au-delà de 5 essais, 429 sans appel d\'authentification', async () => {
  scenario = { limit: false };
  const res = await signIn.fetch(post({ identifier: 'amina_2026', password: 'x' }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '900');
  assert.equal(tokenCalls().length, 0);
});

test('limite : la clé d\'identifiant est un HACHAGE, sans pseudo ni adresse en clair', async () => {
  await signIn.fetch(post({ identifier: 'Amina_2026', password: 'x' }));
  const keys = calls.filter((c) => c.url.includes('consume_rate_limit')).map((c) => JSON.parse(c.init.body).p_key);
  assert.ok(keys.length === 2);
  for (const key of keys) assert.doesNotMatch(key, /amina|203\.0\.113/i);
  assert.match(keys[1], /^sign-in-id:[a-f0-9]{40}$/);
});

test('garde-fous : méthode, type de contenu, taille, JSON invalide', async () => {
  assert.equal((await signIn.fetch(new Request('https://site.test/api/sign-in'))).status, 405);
  assert.equal((await signIn.fetch(new Request('https://site.test/api/sign-in', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }))).status, 415);
  assert.equal((await signIn.fetch(post('x'.repeat(5000)))).status, 413);
  assert.equal((await signIn.fetch(post('{ pas du json'))).status, 400);
});

test('identifiants trop courts ou mot de passe vide : refusés sans appel', async () => {
  const res = await signIn.fetch(post({ identifier: 'ab', password: 'x' }));
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('service Supabase injoignable : 503 générique, rien de sensible', async () => {
  globalThis.fetch = async () => { throw new TypeError(`connexion à ${URL_PROJET} refusée, clé ${SECRET}`); };
  const res = await signIn.fetch(post({ identifier: EMAIL, password: 'motdepasse1' }));
  assert.equal(res.status, 503);
  const all = `${await res.text()} ${logs.join(' ')}`;
  assert.doesNotMatch(all, /sb_secret_|abcdefgh|motdepasse1|amina@/);
});

test('clé secrète absente : 500 générique, aucune valeur affichée', async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  const res = await signIn.fetch(post({ identifier: EMAIL, password: 'motdepasse1' }));
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /sb_/);
});

test('journaux : aucun mot de passe, aucune adresse, aucun pseudo', async () => {
  await signIn.fetch(post({ identifier: 'amina_2026', password: 'motdepasse1' }));
  await signIn.fetch(post({ identifier: 'amina_2026', password: 'faux-mot-de-passe' }));
  assert.doesNotMatch(logs.join(' '), /motdepasse1|faux-mot|amina/);
});
