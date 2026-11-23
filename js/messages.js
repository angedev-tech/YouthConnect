// js/messages.js — messages lisibles pour les erreurs du service d'authentification.
// Les codes viennent du code source public de Supabase Auth. Un code inconnu reçoit un message générique.

const MESSAGES = {
  invalid_credentials: 'Identifiants incorrects.',
  email_not_confirmed: 'Confirme ton adresse e-mail avant de te connecter. Pense à vérifier tes spams.',
  user_already_exists: 'Cette adresse e-mail est déjà utilisée.',
  email_exists: 'Cette adresse e-mail est déjà utilisée.',
  phone_exists: 'Ce numéro de téléphone est déjà utilisé.',
  weak_password: 'Mot de passe trop faible : il doit contenir au moins 10 caractères.',
  same_password: 'Le nouveau mot de passe doit être différent de l\'ancien.',
  over_email_send_rate_limit: 'Trop d\'e-mails envoyés. Réessaie dans quelques minutes.',
  over_sms_send_rate_limit: 'Trop de SMS envoyés. Réessaie plus tard.',
  over_request_rate_limit: 'Trop de tentatives. Réessaie dans quelques minutes.',
  captcha_failed: 'La vérification anti-robot a échoué. Réessaie.',
  otp_expired: 'Ce lien a expiré ou a déjà été utilisé. Demande un nouveau lien.',
  reauthentication_needed: 'Confirme ton identité avec le code reçu par e-mail.',
  email_address_invalid: 'Adresse e-mail invalide.',
  session_not_found: 'Ta session a expiré. Reconnecte-toi.',
  signup_disabled: 'Les inscriptions sont temporairement fermées.',
  validation_failed: 'Une information est invalide. Vérifie le formulaire.',
  bad_jwt: 'Ta session a expiré. Reconnecte-toi.',
};

export const GENERIC_MESSAGE = 'Une erreur est survenue. Réessaie dans un instant.';

/** Message affichable pour une erreur renvoyée par le service d'authentification. */
export function messageForAuthError(error) {
  const code = error?.code || error?.error_code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error?.status === 429) return MESSAGES.over_request_rate_limit;
  return GENERIC_MESSAGE;
}

// Codes SQL que la base utilise pour ses propres messages en français
const CONTROLLED_SQLSTATES = new Set(['22023', '22007', '23505', '42501', 'P0001', 'P0002']);
// Messages techniques : jamais affichés, même avec un code connu
const INTERNAL_DETAIL = /permission denied|does not exist|violates|row-level|duplicate key|relation|column/i;

/** Message affichable pour une erreur renvoyée par la base (appel de fonction). */
export function messageForDatabaseError(error) {
  const text = String(error?.message ?? '');
  if (CONTROLLED_SQLSTATES.has(error?.code) && text && text.length <= 300 && !INTERNAL_DETAIL.test(text)) {
    return text;
  }
  return GENERIC_MESSAGE;
}
