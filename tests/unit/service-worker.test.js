// Le service worker est chargé dans un faux environnement (self, caches, fetch) et on observe ses décisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

function loadWorker({ networkImpl }) {
  const listeners = {};
  const stored = new Map();
  const cache = {
    put: async (req, res) => { stored.set(req.url, res); },
    match: async (req) => stored.get(req.url),
  };
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
    match: async (req) => stored.get(req.url),
  };
  const self = {
    location: { origin: 'https://site.test' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    registration: {},
  };
  const fetchSeen = [];
  const fetchImpl = async (req) => { fetchSeen.push(req); return networkImpl(req); };
  new Function('self', 'caches', 'fetch', 'console', SOURCE)(self, caches, fetchImpl, console);
  return { listeners, stored, fetchSeen };
}

/** Simule un événement fetch : renvoie la réponse prise en charge, ou null si le navigateur gère la requête. */
async function handle(worker, url, init = {}) {
  const request = new Request(url, init);
  const event = { request, respondWith(promise) { this.taken = promise; } };
  worker.listeners.fetch(event);
  return event.taken ? event.taken : null;
}

const okResponse = (body = 'ok') => new Response(body, { status: 200 });
// Une vraie réponse du même site a le type « basic » : on le reproduit, comme le navigateur
const basicResponse = (body = 'ok', status = 200) => Object.defineProperty(new Response(body, { status }), 'type', { value: 'basic' });

test('données d\'un autre site : jamais prises en charge, donc jamais en cache', async () => {
  const w = loadWorker({ networkImpl: async () => okResponse('{"nom":"Amina"}') });
  const r = await handle(w, 'https://abcdefgh.supabase.co/rest/v1/profiles?select=*');
  assert.equal(r, null);
  assert.equal(w.stored.size, 0);
});

test('API du site : jamais en cache', async () => {
  const w = loadWorker({ networkImpl: async () => okResponse('{}') });
  assert.equal(await handle(w, 'https://site.test/api/config'), null);
  assert.equal(await handle(w, 'https://site.test/api/username-available?username=amina'), null);
  assert.equal(w.stored.size, 0);
});

test('requête authentifiée : jamais en cache, même sur le même site', async () => {
  const w = loadWorker({ networkImpl: async () => okResponse('{}') });
  const r = await handle(w, 'https://site.test/style.css', { headers: { Authorization: 'Bearer jeton' } });
  assert.equal(r, null);
  assert.equal(w.stored.size, 0);
});

test('écriture (non GET) : jamais prise en charge', async () => {
  const w = loadWorker({ networkImpl: async () => okResponse() });
  assert.equal(await handle(w, 'https://site.test/index.html', { method: 'POST', body: 'x' }), null);
});

test('fichier statique du site : réseau d\'abord, puis conservé', async () => {
  const w = loadWorker({ networkImpl: async () => basicResponse('body{}') });
  const r = await handle(w, 'https://site.test/style.css');
  assert.equal((await r).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(w.stored.has('https://site.test/style.css'));
});

test('pages d\'authentification (HTML statique) : prises en charge et conservées', async () => {
  const w = loadWorker({ networkImpl: async () => basicResponse('<html>') });
  assert.ok(await handle(w, 'https://site.test/auth/confirm.html'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(w.stored.has('https://site.test/auth/confirm.html'));
});

test('réponse en erreur : jamais conservée', async () => {
  const w = loadWorker({ networkImpl: async () => basicResponse('erreur', 500) });
  await (await handle(w, 'https://site.test/script.js'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(w.stored.size, 0);
});

test('réponse non « basic » (ex. opaque) : jamais conservée', async () => {
  const opaque = { ok: true, type: 'opaque', status: 0, clone() { return this; } };
  const w = loadWorker({ networkImpl: async () => opaque });
  await (await handle(w, 'https://site.test/script.js'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(w.stored.size, 0);
});

test('hors ligne : le fichier statique conservé est servi, sans rien inventer pour l\'API', async () => {
  const w = loadWorker({ networkImpl: async () => okResponse('body{}') });
  await (await handle(w, 'https://site.test/style.css'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Le réseau tombe : on doit retrouver le fichier, et l'API n'est pas gérée du tout
  const offline = loadWorker({ networkImpl: async () => { throw new TypeError('hors ligne'); } });
  offline.stored.set('https://site.test/style.css', okResponse('cache'));
  const r = await handle(offline, 'https://site.test/style.css');
  assert.equal(await (await r).text(), 'cache');
  assert.equal(await handle(offline, 'https://site.test/api/config'), null);
});

test('installation : aucune route d\'API ni de données dans la liste préchargée', () => {
  const liste = SOURCE.slice(SOURCE.indexOf('FICHIERS_A_METTRE_EN_CACHE'), SOURCE.indexOf('];', SOURCE.indexOf('FICHIERS_A_METTRE_EN_CACHE')));
  assert.doesNotMatch(liste, /api|supabase/i);
});
