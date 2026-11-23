#!/usr/bin/env node
// Contrôle de ton projet Supabase avec la SEULE clé publiable. Lecture seule : rien n'est modifié.
//
// Usage :
//   SUPABASE_URL=https://<projet>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_… npm run check:supabase
//
// Le script refuse de tourner si on lui donne une clé secrète : une clé secrète ne doit jamais
// être utilisée sur un poste partagé ni collée dans une conversation.

import { classifyKey } from '../lib/keys.js';

const url = (process.env.SUPABASE_URL || process.argv[2] || '').replace(/\/$/, '');
const key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.argv[3] || '').trim();

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && !/^http:\/\/localhost(:\d+)?$/.test(url)) {
  fail('SUPABASE_URL doit ressembler à https://<projet>.supabase.co');
}
const kind = classifyKey(key);
if (kind === 'secret') {
  fail('ARRÊT : une clé SECRÈTE a été fournie. Utilise la clé publiable (sb_publishable_…). '
    + 'Si une clé secrète a été partagée, fais-en une rotation immédiatement (docs/SECRETS.md).');
}
if (kind !== 'publishable' && kind !== 'legacy-publishable') {
  fail('SUPABASE_PUBLISHABLE_KEY n\'est pas une clé publiable reconnue (attendu : sb_publishable_…).');
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

async function get(path) {
  const response = await fetch(url + path, { headers: { apikey: key }, cache: 'no-store' });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function rpc(name, args) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

try {
  // 1. Réglages d'authentification (lisibles publiquement)
  const settings = await get('/auth/v1/settings');
  const s = settings.body || {};
  check('Confirmation de l\'adresse obligatoire (mailer_autoconfirm = false)', s.mailer_autoconfirm === false,
    'sinon les comptes sont confirmés sans e-mail');
  check('Inscriptions ouvertes (disable_signup = false)', s.disable_signup === false);
  check('Connexion par e-mail active', s.external?.email === true);
  check('Pas de confirmation automatique par téléphone (phone_autoconfirm = false)', s.phone_autoconfirm === false);

  // 2. Migrations appliquées
  const terms = await get('/rest/v1/platform_settings?select=key,value&key=eq.terms_version');
  check('Migrations appliquées (version des CGU publiée)', terms.status === 200 && Array.isArray(terms.body) && terms.body.length === 1,
    'sinon exécute les migrations dans l\'éditeur SQL, dans l\'ordre');
  const stats = await rpc('public_stats', {});
  check('Statistiques publiques disponibles', stats.status === 200 && typeof stats.body?.members === 'number');
  check('10 catégories de départ présentes', stats.body?.categories === 10);

  // 3. Ce qu'un visiteur ne doit PAS pouvoir faire
  check('Compteurs de débit illisibles par un visiteur', (await get('/rest/v1/rate_limits?select=key&limit=1')).status !== 200);
  check('Numéros de téléphone illisibles par un visiteur', (await get('/rest/v1/account_details?select=phone&limit=1')).status !== 200);
  check('Vérification de pseudo réservée au serveur', (await rpc('username_available', { candidate: 'controle_visiteur' })).status !== 200);
  check('Résolution pseudo → e-mail réservée au serveur', (await rpc('resolve_login_email', { candidate: 'controle' })).status !== 200);
  check('Statistiques d\'administration réservées', (await rpc('admin_stats', {})).status !== 200);

  // 4. Ce qui doit rester public
  check('Profils publics lisibles', (await get('/rest/v1/profiles?select=username&limit=1')).status === 200);
} catch (err) {
  fail(`Connexion impossible au projet (${err?.cause?.code || err?.name || 'erreur'}). Vérifie l'adresse et ta connexion.`);
}

const width = Math.max(...results.map((r) => r.name.length));
console.log(`Contrôle de ${url}\n`);
for (const r of results) {
  console.log(`${r.ok ? '✔' : '✘'} ${r.name.padEnd(width)}${r.ok || !r.detail ? '' : `  → ${r.detail}`}`);
}
const failures = results.filter((r) => !r.ok).length;
console.log(failures === 0 ? '\nTout est conforme.' : `\n${failures} point(s) à corriger. Voir docs/CONFIGURATION-SUPABASE.md.`);
process.exit(failures === 0 ? 0 : 1);
