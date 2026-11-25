// api/sign-in.js — connexion par pseudo ou par adresse e-mail.
//
// - Le serveur retrouve l'adresse e-mail d'un pseudo. Elle n'est JAMAIS renvoyée au navigateur.
// - Le mot de passe est transmis à Supabase sur HTTPS et n'est ni stocké, ni journalisé.
// - Deux limites : par adresse IP (20 essais / 15 min) et par identifiant (5 essais / 15 min),
//   pour freiner les tentatives ciblées sur un même compte.
// - Réponses génériques : « identifiants incorrects » que le pseudo existe ou non.
//
// Réponses : 200 tokens de session · 401 identifiants incorrects · 403 e-mail non confirmé
//            · 400 CAPTCHA requis ou invalide · 429 trop d'essais · 503 service indisponible

import { ConfigError, HttpError } from '../lib/errors.js';
import { publicConfig, serverSupabaseConfig, ipHashSecret } from '../lib/env.js';
import { json, readText, clientIp } from '../lib/http.js';
import { consumeKey, subjectHash, allowRequest } from '../lib/ratelimit.js';
import { rpc } from '../lib/supabase-rest.js';

const MAX_BODY_BYTES = 4 * 1024;
const WINDOW_SECONDS = 15 * 60;
const LIMIT_PER_IP = 20;
const LIMIT_PER_IDENTIFIER = 5;
const EMAIL_RE = /^[^\s@<>"']+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const INVALID = () => json({ error: 'Identifiants incorrects.', code: 'invalid_credentials' }, 401);

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405, { Allow: 'POST' });
      const mediaType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (mediaType !== 'application/json') return json({ error: 'Type de contenu non pris en charge.' }, 415);

      const raw = await readText(request, MAX_BODY_BYTES);
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        return json({ error: 'Corps de requête invalide.' }, 400);
      }
      const identifier = typeof input.identifier === 'string' ? input.identifier.trim() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      const captchaToken = typeof input.captchaToken === 'string' && input.captchaToken.length <= 2048
        ? input.captchaToken
        : undefined;
      if (identifier.length < 3 || identifier.length > 254 || password.length < 1 || password.length > 72) {
        return INVALID();
      }

      const supabase = serverSupabaseConfig(process.env);
      const { supabaseUrl, supabasePublishableKey } = publicConfig(process.env);
      const hashSecret = ipHashSecret(process.env);

      // Limite par IP, puis par identifiant : une tentative compte dans les deux
      const ipAllowed = await allowRequest({
        scope: 'sign-in-ip',
        ip: clientIp(request),
        limit: LIMIT_PER_IP,
        windowSeconds: WINDOW_SECONDS,
        url: supabase.url,
        secretKey: supabase.secretKey,
        hashSecret,
      });
      const identifierAllowed = await consumeKey({
        key: `sign-in-id:${subjectHash(hashSecret, identifier.toLowerCase())}`,
        limit: LIMIT_PER_IDENTIFIER,
        windowSeconds: WINDOW_SECONDS,
        url: supabase.url,
        secretKey: supabase.secretKey,
      });
      if (!ipAllowed || !identifierAllowed) {
        return json({ error: 'Trop de tentatives. Réessaie dans quelques minutes.', code: 'rate_limited' }, 429, {
          'Retry-After': String(WINDOW_SECONDS),
        });
      }

      // Pseudo → adresse e-mail (serveur uniquement). Une adresse saisie est utilisée telle quelle.
      let email;
      if (identifier.includes('@')) {
        if (!EMAIL_RE.test(identifier)) return INVALID();
        email = identifier.toLowerCase();
      } else {
        email = await rpc('resolve_login_email', { candidate: identifier }, { url: supabase.url, secretKey: supabase.secretKey });
        if (typeof email !== 'string' || !email) return INVALID();
      }

      const body = { email, password };
      if (captchaToken) body.gotrue_meta_security = { captcha_token: captchaToken };

      const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: supabasePublishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const session = await response.json();
        return json({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          token_type: session.token_type,
        });
      }

      // Erreur du service : on ne transmet que le code, jamais le message ni l'adresse
      const failure = await response.json().catch(() => ({}));
      const code = failure.error_code || failure.code || '';
      if (code === 'captcha_failed') {
        return json({ error: 'La vérification anti-robot a échoué. Réessaie.', code }, 400);
      }
      if (code === 'over_request_rate_limit') {
        return json({ error: 'Trop de tentatives. Réessaie dans quelques minutes.', code }, 429);
      }
      if (code === 'email_not_confirmed') {
        return json({ error: 'Confirme ton adresse e-mail avant de te connecter. Pense à vérifier tes spams.', code }, 403);
      }
      return INVALID();
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err instanceof ConfigError) {
        console.error(`Connexion : configuration incomplète (${err.message})`);
        return json({ error: 'Service indisponible.' }, 500);
      }
      console.error(`Connexion : erreur (${err?.name || 'inconnue'})`);
      return json({ error: 'Service temporairement indisponible.' }, 503);
    }
  },
};
