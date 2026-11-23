import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, normalizeIp, readText, json } from '../../lib/http.js';

test('adresse IP : lue dans x-vercel-forwarded-for, jamais dans une valeur fournie par le visiteur', () => {
  const req = new Request('https://site.test/', {
    headers: { 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' },
  });
  assert.equal(clientIp(req), '203.0.113.7');
});

test('adresse IP : repli sur x-real-ip, puis valeur neutre', () => {
  assert.equal(clientIp(new Request('https://s.test/', { headers: { 'x-real-ip': '192.0.2.4' } })), '192.0.2.4');
  assert.equal(clientIp(new Request('https://s.test/')), 'inconnue');
});

test('IPv6 : tout un /64 donne le même identifiant', () => {
  assert.equal(normalizeIp('2001:db8:1:2::1'), normalizeIp('2001:db8:1:2:ffff:ffff:ffff:ffff'));
  assert.equal(normalizeIp('2001:db8::1'), normalizeIp('2001:db8::2'));
  assert.notEqual(normalizeIp('2001:db8:1::1'), normalizeIp('2001:db8:2::1'));
});

test('IPv4 inchangée', () => {
  assert.equal(normalizeIp('203.0.113.7'), '203.0.113.7');
});

test('corps brut : texte exact, sans réécriture', async () => {
  const raw = '{ "b": 1,  "a": "é" }';
  const text = await readText(new Request('https://s.test/', { method: 'POST', body: raw }), 1024);
  assert.equal(text, raw);
});

test('corps trop volumineux refusé (413)', async () => {
  const big = 'x'.repeat(2000);
  await assert.rejects(
    readText(new Request('https://s.test/', { method: 'POST', body: big }), 1000),
    (err) => err.status === 413,
  );
});

test('réponse JSON : jamais mise en cache par défaut', async () => {
  const res = json({ ok: true }, 201);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), { ok: true });
});
