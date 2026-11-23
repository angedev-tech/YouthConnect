// lib/env.js — une seule source de vérité pour la configuration.
// Chaque variable est lue et validée ici. Une erreur ne montre jamais la valeur reçue.
// Le domaine de la variable (domaine d'envoi, adresse du site…) est choisi par environnement.

import { ConfigError } from './errors.js';
import { assertPublicKey, assertSecretKey } from './keys.js';
import { parseWebhookSecret } from './webhooks.js';

/** Production = déploiement principal Vercel. Preview et Development sont des environnements de test. */
export const isProduction = (env = process.env) => env.VERCEL_ENV === 'production';

function requireVar(env, name) {
  const value = (env[name] ?? '').trim();
  if (!value) throw new ConfigError(`Variable ${name} manquante (voir .env.example et docs/SECRETS.md).`);
  return value;
}

const isLocalHost = (url) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';

/** Adresse du projet Supabase : https, sans chemin (http accepté seulement pour localhost). */
export function parseSupabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('SUPABASE_URL n\'est pas une adresse valide.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url))) {
    throw new ConfigError('SUPABASE_URL doit commencer par https://');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError('SUPABASE_URL doit être l\'adresse seule du projet, sans chemin.');
  }
  return url.origin;
}

/** Adresse publique du site, utilisée dans les liens des e-mails. */
export function parseAppUrl(value, env = process.env) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('APP_URL n\'est pas une adresse valide.');
  }
  if (isProduction(env) && url.protocol !== 'https:') {
    throw new ConfigError('APP_URL doit utiliser https en production.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url))) {
    throw new ConfigError('APP_URL doit utiliser https (http n\'est accepté que pour localhost).');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new ConfigError('APP_URL doit être l\'adresse seule du site (sans chemin, sans paramètres).');
  }
  return url.origin;
}

/**
 * Expéditeur : « Nom <adresse@domaine> » ou « adresse@domaine ».
 * Le domaine est ce qui change quand tu achètes ton domaine : il n'est écrit nulle part dans le code.
 */
export function parseFrom(value) {
  const text = value.trim();
  const named = /^([^<>"\r\n]{1,80})\s*<([^<>\s@]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+))>$/.exec(text);
  const bare = /^([^<>\s@]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+))$/.exec(text);
  if (!named && !bare) {
    throw new ConfigError('EMAIL_FROM doit ressembler à « YouthConnect <no-reply@ton-domaine.fr> ».');
  }
  const address = named ? named[2] : bare[1];
  const domain = (named ? named[3] : bare[2]).toLowerCase();
  return { raw: text, address, domain };
}

/** Configuration de l'envoi d'e-mails. */
export function emailConfig(env = process.env) {
  const from = parseFrom(requireVar(env, 'EMAIL_FROM'));
  if (from.domain === 'resend.dev' && isProduction(env)) {
    throw new ConfigError(
      'EMAIL_FROM utilise le domaine de test resend.dev, interdit en production : il ne livre qu\'à ' +
        'l\'adresse du compte Resend. Configure ton domaine (docs/EMAIL-ET-DOMAINE.md).',
    );
  }
  return {
    from: from.raw,
    fromAddress: from.address,
    fromDomain: from.domain,
    sandbox: from.domain === 'resend.dev',
    appUrl: parseAppUrl(requireVar(env, 'APP_URL'), env),
  };
}

/** Clé Resend : utilisée uniquement côté serveur. */
export function resendApiKey(env = process.env) {
  const key = requireVar(env, 'RESEND_API_KEY');
  if (!/^re_[A-Za-z0-9_]{10,}$/.test(key)) {
    throw new ConfigError('RESEND_API_KEY ne ressemble pas à une clé Resend (elle commence par re_).');
  }
  return key;
}

/** Secret du hook d'e-mail (partagé avec Supabase). */
export function hookSecretKey(env = process.env) {
  return parseWebhookSecret(requireVar(env, 'SEND_EMAIL_HOOK_SECRET'));
}

/** Projet Supabase côté serveur : adresse + clé secrète. */
export function serverSupabaseConfig(env = process.env) {
  return {
    url: parseSupabaseUrl(requireVar(env, 'SUPABASE_URL')),
    secretKey: assertSecretKey(requireVar(env, 'SUPABASE_SECRET_KEY')),
  };
}

/** Ce qui peut être envoyé au navigateur : adresse et clé publiable uniquement. */
export function publicConfig(env = process.env) {
  return {
    supabaseUrl: parseSupabaseUrl(requireVar(env, 'SUPABASE_URL')),
    supabasePublishableKey: assertPublicKey(requireVar(env, 'SUPABASE_PUBLISHABLE_KEY')),
    environment: env.VERCEL_ENV || 'development',
  };
}

/** Clé de hachage des adresses IP (limitation de débit). */
export function ipHashSecret(env = process.env) {
  const value = requireVar(env, 'IP_HASH_SECRET');
  if (value.length < 32) throw new ConfigError('IP_HASH_SECRET doit faire au moins 32 caractères.');
  return value;
}

/** Secret du hook SMS (partagé avec Supabase, forme « v1,whsec_… »). */
export function sendSmsHookSecret(env = process.env) {
  return parseWebhookSecret(requireVar(env, 'SEND_SMS_HOOK_SECRET'));
}

/**
 * Twilio : identifiants du compte et expéditeur.
 * Soit un service de messagerie (recommandé, MG…), soit un numéro ou un nom d'expéditeur.
 */
export function twilioConfig(env = process.env) {
  const accountSid = requireVar(env, 'TWILIO_ACCOUNT_SID');
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    throw new ConfigError('TWILIO_ACCOUNT_SID doit commencer par AC, suivi de 32 caractères.');
  }
  const authToken = requireVar(env, 'TWILIO_AUTH_TOKEN');
  if (!/^[0-9a-fA-F]{32}$/.test(authToken)) {
    throw new ConfigError('TWILIO_AUTH_TOKEN doit comporter 32 caractères hexadécimaux.');
  }
  const messagingServiceSid = (env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  if (messagingServiceSid) {
    if (!/^MG[0-9a-fA-F]{32}$/.test(messagingServiceSid)) {
      throw new ConfigError('TWILIO_MESSAGING_SERVICE_SID doit commencer par MG, suivi de 32 caractères.');
    }
    return { accountSid, authToken, messagingServiceSid };
  }
  const from = (env.TWILIO_FROM || '').trim();
  if (!from) throw new ConfigError('Indique TWILIO_MESSAGING_SERVICE_SID ou TWILIO_FROM.');
  if (!/^\+[1-9][0-9]{7,14}$/.test(from) && !/^[A-Za-z0-9]{3,11}$/.test(from)) {
    throw new ConfigError('TWILIO_FROM doit être un numéro au format international ou un nom d\'expéditeur de 3 à 11 caractères.');
  }
  return { accountSid, authToken, from };
}

/** Plafond global d'SMS par jour (protection contre la fraude par envois massifs). */
export function smsDailyLimit(env = process.env) {
  const raw = (env.SMS_DAILY_LIMIT || '500').trim();
  if (!/^[0-9]{1,6}$/.test(raw) || Number(raw) < 1) {
    throw new ConfigError('SMS_DAILY_LIMIT doit être un nombre entier positif.');
  }
  return Number(raw);
}
