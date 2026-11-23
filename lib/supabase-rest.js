// lib/supabase-rest.js — appel d'une fonction Postgres (RPC) avec la clé SECRÈTE.
// Usage serveur uniquement : cette clé contourne RLS et ne doit jamais atteindre le navigateur.
// Selon la documentation Supabase, les clés publiable et secrète vont dans l'en-tête « apikey » seul.

export class RpcError extends Error {
  constructor(name, status) {
    super(`Appel de la fonction ${name} refusé (HTTP ${status}).`);
    this.name = 'RpcError';
    this.status = status;
  }
}

export async function rpc(name, args, { url, secretKey, fetchImpl = globalThis.fetch, timeoutMs = 4000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: secretKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new RpcError(name, response.status);
  // Une fonction « void » répond 204 sans corps
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
