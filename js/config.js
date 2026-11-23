// js/config.js — configuration publique, lue depuis notre API (jamais écrite dans le code).
// Seules l'adresse du projet et la clé publiable sont reçues ici.

export async function loadPublicConfig(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl('/api/config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error('Configuration indisponible.');
  const config = await response.json();
  if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Configuration incomplète.');
  return config;
}
