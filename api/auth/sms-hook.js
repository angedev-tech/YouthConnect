
// api/auth/sms-hook.js — hook « Send SMS » de Supabase Auth.

import { ConfigError, HttpError } from '../../lib/errors.js';
import {
  serverSupabaseConfig,
  ipHashSecret,
  sendSmsHookSecret,
  twilioConfig,
  smsDailyLimit,
} from '../../lib/env.js';
import { json, readText } from '../../lib/http.js';
import { verifyWebhook, SignatureError } from '../../lib/webhooks.js';
import { consumeKey, subjectHash } from '../../lib/ratelimit.js';
import { rpc } from '../../lib/supabase-rest.js';
import { sendSms, SmsProviderError } from '../../lib/sms/twilio.js';
import { smsText } from '../../lib/sms/messages.js';

const MAX_BODY_BYTES = 16 * 1024;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const OTP = /^[0-9]{4,10}$/;
const PHONE_LIMIT = 3;
const PHONE_WINDOW_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

export default {
  async fetch(request) {
    try {
      if (request.method !== 'POST') {
        return json({ error: 'Méthode non autorisée.' }, 405, { Allow: 'POST' });
      }

      const mediaType = (request.headers.get('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();

      if (mediaType !== 'application/json') {
        return json({ error: 'Type de contenu non pris en charge.' }, 415);
      }

      const rawBody = await readText(request, MAX_BODY_BYTES);

      let supabase;
      let hashSecret;
      let secret;
      let twilio;
      let dailyLimit;

      try {
        supabase = serverSupabaseConfig(process.env);
        hashSecret = ipHashSecret(process.env);
        secret = sendSmsHookSecret(process.env);
        twilio = twilioConfig(process.env);
        dailyLimit = smsDailyLimit(process.env);
      } catch (err) {
        if (err instanceof ConfigError) {
          console.error(`SMS hook : configuration incomplète (${err.message})`);
          return json({ error: 'Configuration du serveur incomplète.' }, 500);
        }
        throw err;
      }

      try {
        verifyWebhook({
          key: secret,
          headers: request.headers,
          rawBody,
        });
      } catch (err) {
        if (err instanceof SignatureError) {
          console.warn(`SMS hook : appel refusé (${err.message})`);
          return json({ error: 'Signature invalide.' }, 401);
        }
        throw err;
      }

      let payload;

      try {
        payload = JSON.parse(rawBody);
      } catch {
        return json({ error: 'Corps de requête invalide.' }, 400);
      }

      // Format du webhook Supabase : user.phone et sms.otp
      const sms = payload?.sms ?? {};
      const phone = payload?.user?.phone;

      if (typeof phone !== 'string' || !E164.test(phone)) {
        return json({ error: 'Numéro invalide.' }, 400);
      }

      const otp = sms.otp;

      if (typeof otp !== 'string' || !OTP.test(otp)) {
        return json({ error: 'Code invalide.' }, 400);
      }

      // 1. Limitation par numéro
      const phoneAllowed = await consumeKey({
        key: `sms-phone:${subjectHash(hashSecret, phone)}`,
        limit: PHONE_LIMIT,
        windowSeconds: PHONE_WINDOW_SECONDS,
        url: supabase.url,
        secretKey: supabase.secretKey,
      });

      if (!phoneAllowed) {
        return json(
          {
            error: 'Trop de SMS demandés pour ce numéro. Réessaie dans une heure.',
            code: 'rate_limited',
          },
          429,
          { 'Retry-After': String(PHONE_WINDOW_SECONDS) },
        );
      }

      // 2. Plafond quotidien global
      const globalAllowed = await consumeKey({
        key: 'sms-global',
        limit: dailyLimit,
        windowSeconds: DAY_SECONDS,
        url: supabase.url,
        secretKey: supabase.secretKey,
      });

      if (!globalAllowed) {
        return json(
          {
            error: 'Envoi de SMS momentanément limité. Réessaie plus tard.',
            code: 'daily_limit',
          },
          429,
          { 'Retry-After': '3600' },
        );
      }

      // 3. Dédoublonnage du webhook
      const webhookId = request.headers.get('webhook-id');
      const firstTime = await rpc(
        'claim_sms_delivery',
        { p_id: webhookId },
        supabase,
      );

      if (firstTime !== true) {
        return new Response(null, { status: 200 });
      }

      try {
        await sendSms({
          accountSid: twilio.accountSid,
          authToken: twilio.authToken,
          to: phone,
          body: smsText({ code: otp }),
          from: twilio.from,
          messagingServiceSid: twilio.messagingServiceSid,
        });
      } catch (err) {
        await rpc(
          'release_sms_delivery',
          { p_id: webhookId },
          supabase,
        ).catch(() => {
          console.error('SMS hook : trace non retirée après un échec.');
        });

        const detail =
          err instanceof SmsProviderError && err.twilioCode
            ? `, code Twilio ${err.twilioCode}`
            : '';

        console.error(`SMS hook : envoi non accepté (${err.message}${detail})`);

        return json(
          { error: "Le SMS n'a pas pu être envoyé. Réessaie dans un instant." },
          502,
        );
      }

      console.info('SMS hook : envoi accepté par le fournisseur.');
      return new Response(null, { status: 200 });

    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message }, err.status);
      }

      console.error(`SMS hook : erreur inattendue (${err?.name || 'inconnue'})`);
      return json({ error: 'Erreur serveur.' }, 500);
    }
  },
};
