// lib/ratelimit.js — limitation des appels répétés sur les routes publiques.
//
// - Les compteurs sont dans Postgres (fonction consume_rate_limit), donc partagés
//   entre toutes les instances Vercel et impossibles à réinitialiser depuis le navigateur.
// - Les identifiants (adresse IP, pseudo, e-mail) ne sont jamais stockés en clair : HMAC avec un secret serveur.
// - Échec fermé : si le compteur ne répond pas, la requête est refusée (pas laissée passer).

import { createHmac } from 'node:crypto';
import { rpc } from './supabase-rest.js';
import { normalizeIp } from './http.js';

/** Empreinte HMAC d'un identifiant (IP, pseudo, e-mail), tronquée. */
export function subjectHash(hashSecret, value) {
  return createHmac('sha256', hashSecret).update(value).digest('hex').slice(0, 40);
}

/** Consomme une unité sur une clé déjà construite. */
export async function consumeKey({ key, limit, windowSeconds, url, secretKey, fetchImpl }) {
  const allowed = await rpc(
    'consume_rate_limit',
    { p_key: key, p_limit: limit, p_window_seconds: windowSeconds },
    { url, secretKey, fetchImpl },
  );
  return allowed === true;
}

/** Limite par adresse IP pour un usage donné (ex. « username-check »). */
export async function allowRequest({ scope, ip, limit, windowSeconds, url, secretKey, hashSecret, fetchImpl }) {
  return consumeKey({
    key: `${scope}:${subjectHash(hashSecret, normalizeIp(ip))}`,
    limit,
    windowSeconds,
    url,
    secretKey,
    fetchImpl,
  });
}
