import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import config from '../../api/config.js';
import usernameRoute from '../../api/username-available.js';
import { findSecretMaterial } from '../../lib/keys.js';

const PUBLISHABLE = 'sb_publishable_ABCDEFGH12345678';
const SECRET = 'sb_secret_ZYXWVUTS87654321';
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'VERCEL_ENV', 'IP_HASH_SECRET'];

let saved;
let originalFetch;
let originalConsole;
let logs;
let rpcCalls;
let rateLimitAllows;
let usernameFree;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    SUPABASE_URL: 'https://abcdefgh.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    SUPABASE_SECRET_KEY: SECRET,
    VERCEL_ENV: 'preview',
    IP_HASH_SECRET: 'x'.repeat(40),
  });
  rpcCalls = [];
  rateLimitAllows = true;
  usernameFree = true;
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const name = String(url).split('/rest/v1/rpc/')[1];
    rpcCalls.push({ name, args: JSON.parse(init.body), apikey: init.headers.apikey, authorization: init.headers.Authorization });
    if (name === 'consume_rate_limit') return new Response(JSON.stringify(rateLimitAllows), { status: 200 });
    if (name === 'username_available') return new Response(JSON.stringify(usernameFree), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  logs = [];
  originalConsole = { error: console.error, warn: console.warn, info: console.info };
  for (const level of ['error', 'warn', 'info']) console[level] = (...a) => logs.push(a.join(' '));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = originalFetch;
  Object.assign(console, originalConsole);
});

/* ── /api/config ───────────────────────────────────────── */

test('/api/config : renvoie l\'adresse et la clé publiable, rien d\'autre', async () => {
  const res = await config.fetch(new Request('https://site.test/api/config'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['environment', 'supabasePublishableKey', 'supabaseUrl']);
  assert.equal(body.supabasePublishableKey, PUBLISHABLE);
  assert.deepEqual(findSecretMaterial(JSON.stringify(body)), [], 'aucun matériel secret dans la réponse');
  assert.match(res.headers.get('cache-control'), /s-maxage/);
});

test('/api/config : la clé secrète n\'est jamais renvoyée, même mal placée', async () => {
  process.env.SUPABASE_PUBLISHABLE_KEY = SECRET;
  const res = await config.fetch(new Request('https://site.test/api/config'));
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.doesNotMatch(text, /sb_secret_/);
  assert.doesNotMatch(logs.join(' '), /sb_secret_/, 'pas non plus dans les journaux');
});

test('/api/config : POST refusé', async () => {
  const res = await config.fetch(new Request('https://site.test/api/config', { method: 'POST' }));
  assert.equal(res.status, 405);
});

/* ── /api/username-available ───────────────────────────── */

const usernameRequest = (name, ip = '203.0.113.9') =>
  new Request(`https://site.test/api/username-available?username=${encodeURIComponent(name)}`, {
    headers: { 'x-vercel-forwarded-for': ip },
  });

test('pseudo libre : disponible, appel avec la clé secrète sur l\'en-tête apikey', async () => {
  const res = await usernameRoute.fetch(usernameRequest('amina_2026'));
  assert.deepEqual(await res.json(), { available: true });
  const check = rpcCalls.find((c) => c.name === 'username_available');
  assert.deepEqual(check.args, { candidate: 'amina_2026' });
  assert.equal(check.apikey, SECRET);
  assert.equal(check.authorization, undefined, 'pas d\'en-tête Authorization : apikey seul');
});

test('pseudo mal formé : réponse immédiate, sans appel de la base', async () => {
  const res = await usernameRoute.fetch(usernameRequest('a b'));
  assert.deepEqual(await res.json(), { available: false, reason: 'format' });
  assert.equal(rpcCalls.some((c) => c.name === 'username_available'), false);
});

test('limite dépassée : 429, la base n\'est pas interrogée', async () => {
  rateLimitAllows = false;
  const res = await usernameRoute.fetch(usernameRequest('amina_2026'));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal(rpcCalls.some((c) => c.name === 'username_available'), false);
});

test('la limite porte sur un HACHAGE de l\'IP : l\'adresse n\'apparaît jamais en clair', async () => {
  await usernameRoute.fetch(usernameRequest('amina_2026', '203.0.113.9'));
  const limit = rpcCalls.find((c) => c.name === 'consume_rate_limit');
  assert.match(limit.args.p_key, /^username-check:[a-f0-9]{40}$/);
  assert.doesNotMatch(limit.args.p_key, /203\.0\.113/);
  assert.equal(limit.args.p_limit, 30);
  assert.equal(limit.args.p_window_seconds, 60);
});

test('deux IP différentes ont des compteurs différents', async () => {
  await usernameRoute.fetch(usernameRequest('amina_2026', '203.0.113.9'));
  await usernameRoute.fetch(usernameRequest('amina_2026', '198.51.100.2'));
  const keys = rpcCalls.filter((c) => c.name === 'consume_rate_limit').map((c) => c.args.p_key);
  assert.notEqual(keys[0], keys[1]);
});

test('compteur indisponible : échec fermé (503), pas de passage libre', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  const res = await usernameRoute.fetch(usernameRequest('amina_2026'));
  assert.equal(res.status, 503);
});

test('clé secrète absente : 500 générique, aucune valeur dans la réponse', async () => {
  delete process.env.SUPABASE_SECRET_KEY;
  const res = await usernameRoute.fetch(usernameRequest('amina_2026'));
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /sb_/);
});
