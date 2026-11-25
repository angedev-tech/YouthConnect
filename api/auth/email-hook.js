// api/auth/email-hook.js — hook « Send Email » de Supabase Auth.
//
// Supabase appelle cette adresse au lieu d'envoyer lui-même les e-mails d'authentification.
// Chaque appel est signé (Standard Webhooks) : sans signature valide, rien n'est envoyé.
//
// Réponses :
//   200 (corps vide) → Resend a confirmé l'envoi (Supabase attend ce format)
//   401 → signature invalide ou horodatage trop ancien
//   400 / 415 / 413 / 422 → appel mal formé ou type d'e-mail non géré
//   502 → Resend n'a pas confirmé l'envoi : Supabase signale l'échec à l'utilisateur
//
// Un nouvel essai de Supabase ne renvoie pas un second e-mail : chaque envoi porte une clé
// d'idempotence construite à partir de webhook-id.

import { ConfigError, HttpError } from '../../lib/errors.js';
import { emailConfig, resendApiKey, hookSecretKey } from '../../lib/env.js';
import { json, readText } from '../../lib/http.js';
import { verifyWebhook, SignatureError } from '../../lib/webhooks.js';
import { buildAuthMessages, InvalidAuthPayload, UnsupportedAuthEmail } from '../../lib/email/auth-messages.js';
import { sendEmail } from '../../lib/email/resend.js';

const MAX_BODY_BYTES = 64 * 1024;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json({ error: 'Méthode non autorisée.' }, 405, { Allow: 'POST' });
      }
      const mediaType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (mediaType !== 'application/json') {
        return json({ error: 'Type de contenu non pris en charge.' }, 415);
      }

      // Corps brut lu AVANT toute analyse : la signature porte sur ces octets exacts
      const rawBody = await readText(request, MAX_BODY_BYTES);

      let config;
      let apiKey;
      let secret;
      try {
        config = emailConfig(process.env);
        apiKey = resendApiKey(process.env);
        secret = hookSecretKey(process.env);
      } catch (err) {
        if (err instanceof ConfigError) {
          console.error(`Hook e-mail : configuration incomplète (${err.message})`);
          return json({ error: 'Configuration du serveur incomplète.' }, 500);
        }
        throw err;
      }

      try {
        verifyWebhook({ key: secret, headers: request.headers, rawBody });
      } catch (err) {
        if (err instanceof SignatureError) {
          console.warn(`Hook e-mail : appel refusé (${err.message})`);
          return json({ error: 'Signature invalide.' }, 401);
        }
        throw err;
      }

      let messages;
      try {
        messages = buildAuthMessages(JSON.parse(rawBody), { appUrl: config.appUrl });
      } catch (err) {
        if (err instanceof UnsupportedAuthEmail) {
          console.warn(`Hook e-mail : type non géré (${err.message})`);
          return json({ error: 'Type d\'e-mail non géré.' }, 422);
        }
        if (err instanceof InvalidAuthPayload || err instanceof SyntaxError) {
          console.warn('Hook e-mail : charge utile invalide');
          return json({ error: 'Corps de requête invalide.' }, 400);
        }
        throw err;
      }

      const webhookId = request.headers.get('webhook-id') || 'sans-id';
      for (const [index, message] of messages.entries()) {
        try {
          await sendEmail({
            apiKey,
            from: config.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            idempotencyKey: `${webhookId}:${index}`,
          });
        } catch (err) {
          // Journal sans adresse, sans lien et sans contenu
          console.error(`Hook e-mail : envoi non confirmé (${err.message})`);
          return json({ error: 'L\'e-mail n\'a pas pu être envoyé. Réessaie dans un instant.' }, 502);
        }
      }

      console.info(`Hook e-mail : ${messages.length} message(s) confirmé(s) par le fournisseur.`);
      return new Response(null, { status: 200 });
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(`Hook e-mail : erreur inattendue (${err?.name || 'inconnue'})`);
      return json({ error: 'Erreur serveur.' }, 500);
    }
  },
};
