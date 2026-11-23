// lib/webhooks.js — vérification des appels signés par Supabase (spécification Standard Webhooks).
//
// Signature : HMAC-SHA256 de « {webhook-id}.{webhook-timestamp}.{corps brut} »,
// clé = secret sans son préfixe whsec_, décodé en base64. Résultat : « v1,<base64> ».
// Protection contre le rejeu : horodatage accepté à ±300 secondes près.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigError } from './errors.js';

export class SignatureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SignatureError';
  }
}

/** Accepte « v1,whsec_<base64> » (forme affichée par Supabase) ou « whsec_<base64> ». */
export function parseWebhookSecret(value) {
  let s = String(value ?? '').trim();
  if (s.startsWith('v1,')) s = s.slice(3);
  if (!s.startsWith('whsec_')) {
    throw new ConfigError('Le secret du hook doit commencer par whsec_ : copie-le tel qu\'il est affiché dans Supabase.');
  }
  const key = Buffer.from(s.slice('whsec_'.length), 'base64');
  if (key.length < 16) throw new ConfigError('Le secret du hook semble incomplet.');
  return key;
}

/**
 * Vérifie la signature d'une requête entrante. Lève SignatureError si elle est invalide.
 * @param {{key: Buffer, headers: Headers, rawBody: string, now?: number, toleranceSeconds?: number}} args
 */
export function verifyWebhook({ key, headers, rawBody, now = Date.now(), toleranceSeconds = 300 }) {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatureHeader = headers.get('webhook-signature');
  if (!id || !timestamp || !signatureHeader) throw new SignatureError('en-têtes de signature manquants');
  if (!/^\d+$/.test(timestamp)) throw new SignatureError('horodatage mal formé');

  const ageSeconds = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (ageSeconds > toleranceSeconds) throw new SignatureError('horodatage hors tolérance (rejeu possible)');

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`, 'utf8').digest();

  // L'en-tête peut contenir plusieurs signatures (rotation de clé) : « v1,<b64> v1,<b64> »
  for (const candidate of signatureHeader.split(' ')) {
    if (!candidate.startsWith('v1,')) continue;
    const given = Buffer.from(candidate.slice(3), 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  throw new SignatureError('signature invalide');
}
