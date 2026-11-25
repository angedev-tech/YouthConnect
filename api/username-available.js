// api/username-available.js — « ce pseudo est-il libre ? » sans exposer la base aux robots.
//
// La fonction Postgres username_available n'est plus appelable directement par le navigateur :
// seule cette route, limitée par adresse IP, peut la lancer. Sans cette limite, un robot
// pourrait énumérer tous les pseudos existants.

import { ConfigError } from '../lib/errors.js';
import { serverSupabaseConfig, ipHashSecret } from '../lib/env.js';
import { json, clientIp } from '../lib/http.js';
import { allowRequest } from '../lib/ratelimit.js';
import { rpc } from '../lib/supabase-rest.js';

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;
const LIMIT = 30; // vérifications
const WINDOW_SECONDS = 60; // par minute et par adresse IP

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return json({ error: 'Méthode non autorisée.' }, 405, { Allow: 'GET' });
    }
    try {
      const { url, secretKey } = serverSupabaseConfig(process.env);
      const hashSecret = ipHashSecret(process.env);

      // La limite s'applique avant toute analyse : une tentative mal formée compte aussi
      const allowed = await allowRequest({
        scope: 'username-check',
        ip: clientIp(request),
        limit: LIMIT,
        windowSeconds: WINDOW_SECONDS,
        url,
        secretKey,
        hashSecret,
      });
      if (!allowed) {
        return json(
          { error: 'Trop de vérifications. Réessaie dans une minute.' },
          429,
          { 'Retry-After': String(WINDOW_SECONDS) },
        );
      }

      const username = new URL(request.url).searchParams.get('username') || '';
      if (!USERNAME_RE.test(username)) {
        return json({ available: false, reason: 'format' });
      }

      const available = await rpc('username_available', { candidate: username }, { url, secretKey });
      return json({ available: available === true });
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(`Vérification de pseudo : configuration incomplète (${err.message})`);
        return json({ error: 'Service indisponible.' }, 500);
      }
      console.error(`Vérification de pseudo : erreur (${err?.name || 'inconnue'})`);
      return json({ error: 'Service temporairement indisponible.' }, 503);
    }
  },
};
