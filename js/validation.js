// js/validation.js — règles de saisie, identiques à celles de la base et des fonctions serveur.
// Si une règle change, la modifier ICI et dans supabase/migrations et lib/email/auth-messages.js.
// Les contrôles du navigateur améliorent le confort ; la base reste la référence.

export const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;
export const RESERVED_USERNAMES = ['admin', 'administrateur', 'support', 'moderateur', 'youthconnect', 'system', 'root'];
export const PHONE_E164_RE = /^\+[1-9][0-9]{7,14}$/;
export const EMAIL_RE = /^[^\s@<>"']+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72; // limite du service d'authentification
export const NAME_MAX_LENGTH = 60;

// Indicatifs proposés à l'inscription (le Togo en premier). Ajouter un pays = une ligne ici.
export const COUNTRY_CODES = [
  { code: '+228', label: 'Togo (+228)' },
  { code: '+229', label: 'Bénin (+229)' },
  { code: '+225', label: 'Côte d\'Ivoire (+225)' },
  { code: '+226', label: 'Burkina Faso (+226)' },
  { code: '+221', label: 'Sénégal (+221)' },
  { code: '+233', label: 'Ghana (+233)' },
  { code: '+234', label: 'Nigéria (+234)' },
  { code: '+237', label: 'Cameroun (+237)' },
  { code: '+33', label: 'France (+33)' },
];

export function validateUsername(value) {
  const v = String(value ?? '').trim();
  if (!USERNAME_RE.test(v)) {
    return { ok: false, message: 'Le pseudo doit contenir de 3 à 30 caractères : lettres sans accent, chiffres ou tiret bas.' };
  }
  if (RESERVED_USERNAMES.includes(v.toLowerCase())) return { ok: false, message: 'Ce pseudo est réservé.' };
  return { ok: true, value: v };
}

export function validateName(value, label) {
  const v = String(value ?? '').trim();
  if (v.length < 1) return { ok: false, message: `${label} est obligatoire.` };
  if (v.length > NAME_MAX_LENGTH) return { ok: false, message: `${label} ne doit pas dépasser ${NAME_MAX_LENGTH} caractères.` };
  return { ok: true, value: v };
}

export function validateEmail(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v.length > 254 || !EMAIL_RE.test(v)) return { ok: false, message: 'Adresse e-mail invalide.' };
  return { ok: true, value: v };
}

/** Assemble indicatif + numéro local en format international (E.164). */
export function buildPhone(countryCode, localNumber) {
  const digits = String(localNumber ?? '').replace(/[\s.\-()]/g, '');
  if (!digits) return { ok: false, message: 'Le numéro de téléphone est obligatoire.' };
  if (!/^[0-9]+$/.test(digits)) return { ok: false, message: 'Le numéro ne doit contenir que des chiffres.' };
  if (digits.startsWith('0')) {
    return { ok: false, message: 'Écris le numéro sans le 0 initial : l\'indicatif suffit.' };
  }
  const phone = `${countryCode}${digits}`;
  if (!PHONE_E164_RE.test(phone)) return { ok: false, message: 'Numéro de téléphone invalide.' };
  return { ok: true, value: phone };
}

export function validatePassword(value, email = '') {
  const v = String(value ?? '');
  if (v.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.` };
  }
  if (new TextEncoder().encode(v).length > PASSWORD_MAX_BYTES) {
    return { ok: false, message: 'Le mot de passe est trop long.' };
  }
  if (email && v.toLowerCase() === String(email).toLowerCase()) {
    return { ok: false, message: 'Le mot de passe ne doit pas être ton adresse e-mail.' };
  }
  return { ok: true, value: v };
}

export function validatePasswordConfirmation(password, confirmation) {
  if (password !== confirmation) return { ok: false, message: 'Les deux mots de passe ne correspondent pas.' };
  return { ok: true };
}

/**
 * Valide l'ensemble du formulaire d'inscription.
 * @returns {{ok: boolean, errors: Record<string,string>, values?: object}}
 */
export function validateSignup(input) {
  const errors = {};
  const username = validateUsername(input.username);
  if (!username.ok) errors.username = username.message;
  const first = validateName(input.firstName, 'Le prénom');
  if (!first.ok) errors.firstName = first.message;
  const last = validateName(input.lastName, 'Le nom');
  if (!last.ok) errors.lastName = last.message;
  const email = validateEmail(input.email);
  if (!email.ok) errors.email = email.message;
  const phone = buildPhone(input.countryCode, input.localPhone);
  if (!phone.ok) errors.phone = phone.message;
  const password = validatePassword(input.password, email.ok ? email.value : '');
  if (!password.ok) errors.password = password.message;
  const confirmation = validatePasswordConfirmation(input.password, input.passwordConfirmation);
  if (!confirmation.ok) errors.passwordConfirmation = confirmation.message;
  if (input.termsAccepted !== true) errors.terms = 'Tu dois accepter les conditions d\'utilisation.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors,
    values: {
      username: username.value,
      firstName: first.value,
      lastName: last.value,
      email: email.value,
      phone: phone.value,
      password: password.value,
    },
  };
}

/**
 * Date de naissance : au moins 18 ans révolus à la date du jour (même règle que la base).
 * La base refait la vérification : cette fonction ne sert qu'à donner un retour immédiat.
 */
export function validateBirthDate(value, today = new Date()) {
  const v = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, message: 'Indique ta date de naissance.' };
  const [y, m, d] = v.split('-').map(Number);
  const birth = new Date(Date.UTC(y, m - 1, d));
  if (birth.getUTCFullYear() !== y || birth.getUTCMonth() !== m - 1 || birth.getUTCDate() !== d) {
    return { ok: false, message: 'Date de naissance invalide.' };
  }
  const limit = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  if (birth > limit) return { ok: false, message: 'Inscription réservée aux personnes âgées de 18 ans ou plus.' };
  return { ok: true, value: v };
}
