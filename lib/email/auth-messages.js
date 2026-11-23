// lib/email/auth-messages.js — de la charge utile du hook Supabase aux e-mails à envoyer.
//
// Règles :
// - l'adresse de destination vient de la charge SIGNÉE par Supabase, jamais d'une autre source ;
// - les jetons (token_hash) sont validés avant d'entrer dans une URL ;
// - un type d'e-mail non prévu est refusé (pas d'envoi silencieux, pas de faux succès).

import {
  authLink, signupMessage, recoveryMessage, emailChangeCurrentMessage, emailChangeNewMessage,
  reauthenticationMessage, passwordChangedMessage, emailChangedNotificationMessage,
} from './templates.js';

export class InvalidAuthPayload extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidAuthPayload';
  }
}

export class UnsupportedAuthEmail extends Error {
  constructor(type) {
    super(type);
    this.name = 'UnsupportedAuthEmail';
  }
}

const EMAIL_RE = /^[^\s@<>"']+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const HASH_RE = /^[a-f0-9]{32,128}$/;
const CODE_RE = /^[0-9]{4,10}$/;
// Types gérés. Tout autre type est refusé (422) : ne pas activer les autres notifications dans Supabase.
const SUPPORTED_TYPES = new Set([
  'signup', 'recovery', 'email_change', 'reauthentication',
  'password_changed_notification', 'email_changed_notification',
]);

/** Vérifie la forme de la charge utile. Lève InvalidAuthPayload sinon. */
export function validateHookPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new InvalidAuthPayload('corps inattendu');
  const user = payload.user;
  const data = payload.email_data;
  if (!user || typeof user.email !== 'string' || !EMAIL_RE.test(user.email)) {
    throw new InvalidAuthPayload('adresse du compte absente ou invalide');
  }
  if (!data || typeof data.email_action_type !== 'string') {
    throw new InvalidAuthPayload('type d\'e-mail absent');
  }
  for (const field of ['token_hash', 'token_hash_new']) {
    const value = data[field];
    if (value !== undefined && value !== '' && (typeof value !== 'string' || !HASH_RE.test(value))) {
      throw new InvalidAuthPayload(`${field} mal formé`);
    }
  }
  return { user, data };
}

/**
 * Renvoie la liste des messages à envoyer pour un appel du hook.
 * @returns {Array<{to: string, subject: string, html: string, text: string}>}
 */
export function buildAuthMessages(payload, { appUrl }) {
  const { user, data } = validateHookPayload(payload);
  const type = data.email_action_type;
  if (!SUPPORTED_TYPES.has(type)) throw new UnsupportedAuthEmail(type);

  const newEmail = typeof user.new_email === 'string' && EMAIL_RE.test(user.new_email) ? user.new_email : null;

  switch (type) {
    case 'signup':
      if (!data.token_hash) throw new InvalidAuthPayload('jeton de confirmation absent');
      return [{ to: user.email, ...signupMessage({ url: authLink(appUrl, '/auth/confirm', data.token_hash, 'signup') }) }];

    case 'recovery':
      if (!data.token_hash) throw new InvalidAuthPayload('jeton de réinitialisation absent');
      return [{ to: user.email, ...recoveryMessage({ url: authLink(appUrl, '/auth/reset-password', data.token_hash, 'recovery') }) }];

    case 'email_change': {
      // Changement sécurisé : deux messages. Le jeton « _new » va à l'adresse actuelle,
      // le jeton simple va à la nouvelle adresse (règle de la documentation Supabase).
      const messages = [];
      if (data.token_hash_new) {
        messages.push({
          to: user.email,
          ...emailChangeCurrentMessage({ url: authLink(appUrl, '/auth/confirm', data.token_hash_new, 'email_change') }),
        });
      }
      if (data.token_hash) {
        if (!newEmail) throw new InvalidAuthPayload('nouvelle adresse absente');
        messages.push({
          to: newEmail,
          ...emailChangeNewMessage({ url: authLink(appUrl, '/auth/confirm', data.token_hash, 'email_change') }),
        });
      }
      if (messages.length === 0) throw new InvalidAuthPayload('aucun lien à envoyer');
      return messages;
    }

    case 'reauthentication': {
      // Code à 6 chiffres (longueur configurable côté Supabase) envoyé dans token
      if (!data.token || !CODE_RE.test(data.token)) throw new InvalidAuthPayload('code de confirmation invalide');
      return [{ to: user.email, ...reauthenticationMessage({ code: data.token }) }];
    }

    case 'password_changed_notification':
      return [{ to: user.email, ...passwordChangedMessage() }];

    case 'email_changed_notification': {
      // Alerte de sécurité : elle part vers l'ANCIENNE adresse (old_email), pas vers la nouvelle
      const oldEmail = typeof data.old_email === 'string' && EMAIL_RE.test(data.old_email) ? data.old_email : null;
      if (!oldEmail) throw new InvalidAuthPayload('ancienne adresse absente');
      return [{ to: oldEmail, ...emailChangedNotificationMessage() }];
    }

    default:
      throw new UnsupportedAuthEmail(type);
  }
}
