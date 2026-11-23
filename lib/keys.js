// lib/keys.js — reconnaître le type d'une clé Supabase sans jamais l'afficher.
//
// Clés acceptées dans le navigateur : sb_publishable_… (ou l'ancienne clé JWT « anon »).
// Clés réservées au serveur : sb_secret_… (ou l'ancienne clé JWT « service_role »).
// Une clé service_role est un JWT : son rôle est lu dans sa charge utile.

import { ConfigError } from './errors.js';

/** @returns {'missing'|'publishable'|'legacy-publishable'|'secret'|'unknown'} */
export function classifyKey(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return 'missing';
  if (v.startsWith('sb_publishable_')) return 'publishable';
  if (v.startsWith('sb_secret_')) return 'secret';
  if (v.startsWith('eyJ')) {
    const role = jwtRole(v);
    if (role === 'anon') return 'legacy-publishable';
    if (role === 'service_role') return 'secret';
  }
  return 'unknown';
}

/** Lit le champ « role » d'un JWT, sans vérifier sa signature (on ne fait que classer). */
export function jwtRole(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Accepte uniquement une clé destinée au navigateur. Refuse une clé secrète, sans jamais l'afficher. */
export function assertPublicKey(value, label = 'SUPABASE_PUBLISHABLE_KEY') {
  const kind = classifyKey(value);
  if (kind === 'publishable' || kind === 'legacy-publishable') return value.trim();
  if (kind === 'secret') {
    throw new ConfigError(
      `${label} contient une clé SECRÈTE. Elle ne doit jamais atteindre le navigateur : ` +
        'mets la clé publiable à la place, puis fais une rotation de la clé secrète (docs/SECRETS.md).',
    );
  }
  throw new ConfigError(`${label} n'est pas une clé publiable Supabase reconnue (attendu : sb_publishable_…).`);
}

/** Accepte uniquement une clé secrète, pour les fonctions serveur. */
export function assertSecretKey(value, label = 'SUPABASE_SECRET_KEY') {
  const kind = classifyKey(value);
  if (kind === 'secret') return value.trim();
  if (kind === 'publishable' || kind === 'legacy-publishable') {
    throw new ConfigError(`${label} contient une clé PUBLIABLE : mets la clé secrète (attendu : sb_secret_…).`);
  }
  throw new ConfigError(`${label} n'est pas une clé secrète Supabase reconnue (attendu : sb_secret_…).`);
}

/**
 * Cherche du matériel secret dans un texte destiné au navigateur.
 * Ne renvoie que le type trouvé et la position, jamais la valeur.
 */
export function findSecretMaterial(text) {
  const findings = [];
  const add = (kind, match) => findings.push({ kind, index: match.index });

  for (const m of text.matchAll(/sb_secret_[A-Za-z0-9_-]{8,}/g)) add('clé secrète Supabase (sb_secret_)', m);
  for (const m of text.matchAll(/whsec_[A-Za-z0-9+/=]{16,}/g)) add('secret de webhook (whsec_)', m);
  for (const m of text.matchAll(/\bre_[A-Za-z0-9_]{16,}\b/g)) add('clé API Resend (re_)', m);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    if (jwtRole(m[0]) === 'service_role') add('clé service_role (JWT)', m);
  }
  for (const m of text.matchAll(/RESEND_API_KEY|SUPABASE_SECRET_KEY|SEND_EMAIL_HOOK_SECRET|IP_HASH_SECRET|service_role/g)) {
    add(`nom de variable serveur (${m[0]})`, m);
  }
  return findings;
}
