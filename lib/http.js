// lib/http.js — utilitaires HTTP pour les fonctions Vercel (API Web standard : Request / Response).

import { HttpError } from './errors.js';

/** Réponse JSON. Jamais mise en cache par défaut. */
export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

/**
 * Lit le corps BRUT (octets décodés en texte, sans re-sérialisation) et refuse
 * les corps trop gros. Indispensable pour vérifier une signature.
 */
export async function readText(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'Corps de requête trop volumineux.');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new HttpError(413, 'Corps de requête trop volumineux.');
  }
  return text;
}

/**
 * Adresse IP du visiteur. Vercel réécrit x-forwarded-for avec la vraie adresse :
 * on lit donc x-vercel-forwarded-for (ou x-real-ip), jamais une valeur choisie par le visiteur.
 * Si un proxy est ajouté devant Vercel (ex. Cloudflare), cette lecture devra être adaptée.
 */
export function clientIp(request) {
  const raw = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || '';
  return normalizeIp(raw.split(',')[0].trim()) || 'inconnue';
}

/** IPv4 inchangée. IPv6 : on ne garde que le préfixe /64 (un abonné ne peut pas échapper à la limite en changeant d'adresse). */
export function normalizeIp(ip) {
  if (!ip) return '';
  if (!ip.includes(':')) return ip;
  const groups = expandIpv6(ip);
  if (!groups) return ip;
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function expandIpv6(ip) {
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts[1] ? parts[1].split(':') : [];
  const missing = 8 - (head.length + tail.length);
  if (missing < 0) return null;
  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-fA-F]{0,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0').toLowerCase());
}
