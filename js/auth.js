// js/auth.js — parcours d'authentification (inscription, connexion, réinitialisation, réglages).
// Le client Supabase et fetch sont injectés : ce module se teste sans navigateur.
//
// Règles :
// - toute saisie est validée avant l'appel réseau ;
// - le mot de passe n'entre jamais dans les métadonnées ni dans les journaux ;
// - la réponse à « mot de passe oublié » est identique que le compte existe ou non ;
// - une réinitialisation ferme toutes les sessions ; un changement de mot de passe ferme les autres.

import { messageForAuthError, messageForDatabaseError, GENERIC_MESSAGE } from './messages.js';
import {
  validateSignup, validateEmail, validatePassword, validatePasswordConfirmation,
  validateUsername, validateBirthDate, buildPhone,
} from './validation.js';

export class AuthFlowError extends Error {
  constructor(message, code = 'error', fields = null) {
    super(message);
    this.name = 'AuthFlowError';
    this.code = code;
    this.fields = fields;
  }
}

const firstMessage = (errors) => Object.values(errors)[0] || GENERIC_MESSAGE;

export function createAuth({ client, fetchImpl = globalThis.fetch, apiBase = '' }) {
  const api = (path) => `${apiBase}${path}`;

  /** « Ce pseudo est-il libre ? » via notre API limitée. */
  async function isUsernameAvailable(username) {
    const response = await fetchImpl(api(`/api/username-available?username=${encodeURIComponent(username)}`), {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (response.status === 429) throw new AuthFlowError('Trop de vérifications. Réessaie dans une minute.', 'rate_limited');
    if (!response.ok) throw new AuthFlowError(GENERIC_MESSAGE, 'unavailable');
    const data = await response.json();
    return data.available === true;
  }

  /** Inscription. Le pseudo, le nom, le téléphone et la version des CGU partent dans les métadonnées : la base les revalide. */
  async function signUp(input, { captchaToken, termsVersion } = {}) {
    const checked = validateSignup(input);
    if (!checked.ok) throw new AuthFlowError(firstMessage(checked.errors), 'validation', checked.errors);
    if (!termsVersion) throw new AuthFlowError(GENERIC_MESSAGE, 'terms_missing');

    const v = checked.values;
    if (!(await isUsernameAvailable(v.username))) {
      throw new AuthFlowError('Ce pseudo est déjà pris.', 'username_taken', { username: 'Ce pseudo est déjà pris.' });
    }

    const { error } = await client.auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        data: {
          username: v.username,
          first_name: v.firstName,
          last_name: v.lastName,
          phone: v.phone,
          terms_version: termsVersion,
        },
        captchaToken,
      },
    });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'signup_failed');

    // Message identique que l'adresse soit nouvelle ou non : pas de révélation de comptes existants
    return { confirmationMessage: 'Vérifie ta boîte mail : si cette adresse est nouvelle, un lien de confirmation vient d\'être envoyé.' };
  }

  /** Connexion par e-mail et mot de passe. */
  async function signInWithEmail({ email, password, captchaToken }) {
    const v = validateEmail(email);
    if (!v.ok) throw new AuthFlowError(v.message, 'validation', { email: v.message });
    const { error } = await client.auth.signInWithPassword({ email: v.value, password, options: { captchaToken } });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'sign_in_failed');
    return { ok: true };
  }

  /** Connexion par pseudo : le serveur retrouve l'e-mail sans jamais le renvoyer ici, puis ouvre la session. */
  async function signInWithUsername({ username, password, captchaToken }) {
    const response = await fetchImpl(api('/api/sign-in'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: username, password, captchaToken }),
      credentials: 'omit',
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new AuthFlowError(data.error || GENERIC_MESSAGE, data.code || 'sign_in_failed');

    const { error } = await client.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (error) throw new AuthFlowError(GENERIC_MESSAGE, 'session_failed');
    return { ok: true };
  }

  /** Point d'entrée unique : un pseudo est résolu côté serveur, une adresse e-mail est utilisée telle quelle. */
  async function signIn({ identifier, password, captchaToken }) {
    const id = String(identifier ?? '').trim();
    if (!id || !password) throw new AuthFlowError('Renseigne ton identifiant et ton mot de passe.', 'validation');
    if (id.includes('@')) return signInWithEmail({ email: id, password, captchaToken });
    return signInWithUsername({ username: id, password, captchaToken });
  }

  /** Déconnexion de cet appareil uniquement. */
  async function signOut() {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw new AuthFlowError(GENERIC_MESSAGE, error.code || 'sign_out_failed');
    return { ok: true };
  }

  /** « Mot de passe oublié » : même réponse que le compte existe ou non. */
  async function requestPasswordReset({ email, captchaToken }) {
    const v = validateEmail(email);
    if (!v.ok) throw new AuthFlowError(v.message, 'validation', { email: v.message });
    const { error } = await client.auth.resetPasswordForEmail(v.value, { captchaToken });
    if (error && error.code !== 'user_not_found') {
      throw new AuthFlowError(messageForAuthError(error), error.code || 'reset_failed');
    }
    return { confirmationMessage: 'Si un compte existe avec cette adresse, un lien de réinitialisation vient d\'être envoyé. Pense à vérifier tes spams.' };
  }

  /** Validation d'un lien de confirmation (inscription ou changement d'adresse). */
  async function confirmEmail({ tokenHash, type }) {
    if (!['signup', 'email_change'].includes(type)) throw new AuthFlowError('Lien invalide.', 'validation');
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'confirm_failed');
    return { ok: true, type };
  }

  /** Ouvre la session de réinitialisation à partir du lien reçu. */
  async function openRecoverySession({ tokenHash }) {
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'recovery_failed');
    return { ok: true };
  }

  /** Nouveau mot de passe après un lien de réinitialisation. Toutes les sessions sont fermées ensuite. */
  async function setNewPassword({ password, confirmation, email }) {
    const check = validatePassword(password, email);
    if (!check.ok) throw new AuthFlowError(check.message, 'validation', { password: check.message });
    const same = validatePasswordConfirmation(password, confirmation);
    if (!same.ok) throw new AuthFlowError(same.message, 'validation', { passwordConfirmation: same.message });

    const { error } = await client.auth.updateUser({ password: check.value });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'update_failed');

    await client.auth.signOut({ scope: 'global' });
    return { ok: true };
  }

  /** Envoie un code de confirmation par e-mail (requis si « Secure password change » est activé). */
  async function requestReauthentication() {
    const { error } = await client.auth.reauthenticate();
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'reauth_failed');
    return { ok: true, confirmationMessage: 'Un code de confirmation vient d\'être envoyé à ton adresse e-mail.' };
  }

  /** Changement de mot de passe depuis les paramètres. Les autres sessions sont fermées. */
  async function changePassword({ email, currentPassword, newPassword, confirmation, nonce }) {
    const check = validatePassword(newPassword, email);
    if (!check.ok) throw new AuthFlowError(check.message, 'validation', { newPassword: check.message });
    const same = validatePasswordConfirmation(newPassword, confirmation);
    if (!same.ok) throw new AuthFlowError(same.message, 'validation', { confirmation: same.message });

    if (!nonce) {
      // Preuve de l'identité : l'ancien mot de passe doit être correct
      const { error } = await client.auth.signInWithPassword({ email, password: currentPassword });
      if (error) throw new AuthFlowError('Mot de passe actuel incorrect.', 'invalid_credentials', { currentPassword: 'Mot de passe actuel incorrect.' });
    }

    const { error } = await client.auth.updateUser({ password: check.value, ...(nonce ? { nonce } : {}) });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'update_failed');

    await client.auth.signOut({ scope: 'others' });
    return { ok: true };
  }

  /** Changement d'adresse : la base et le hook envoient les confirmations. */
  async function changeEmail({ newEmail }) {
    const v = validateEmail(newEmail);
    if (!v.ok) throw new AuthFlowError(v.message, 'validation', { newEmail: v.message });
    const { error } = await client.auth.updateUser({ email: v.value });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'email_change_failed');
    return { ok: true, confirmationMessage: 'Un lien de confirmation vient d\'être envoyé à la nouvelle adresse. Ton adresse actuelle sera aussi prévenue.' };
  }

  /** Utilisateur connecté, ou null. */
  async function currentUser() {
    const { data } = await client.auth.getUser();
    return data?.user ?? null;
  }

  /** Connexion Google (D2). Le navigateur est redirigé vers Google, puis revient sur /auth/callback. */
  async function signInWithGoogle({ redirectTo }) {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'oauth_failed');
    return { url: data?.url ?? null };
  }

  /** Retour de Google : le code à usage unique est échangé contre une session. */
  async function exchangeOAuthCode({ code }) {
    if (!/^[A-Za-z0-9._~-]{10,256}$/.test(String(code ?? ''))) {
      throw new AuthFlowError('Lien de connexion invalide.', 'validation');
    }
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'exchange_failed');
    return { ok: true };
  }

  /** Envoie un code SMS au numéro saisi (D3). Le compte doit être connecté. */
  async function requestPhoneVerification({ countryCode, localPhone }) {
    const phone = buildPhone(countryCode, localPhone);
    if (!phone.ok) throw new AuthFlowError(phone.message, 'validation', { phone: phone.message });
    const { error } = await client.auth.updateUser({ phone: phone.value });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'phone_failed');
    return { confirmationMessage: 'Un code à 6 chiffres vient d\'être envoyé par SMS.' };
  }

  /** Vérifie le code SMS. Le numéro devient vérifié côté base, qui recalcule l'activation du compte. */
  async function verifyPhoneCode({ phone, token }) {
    if (!/^[0-9]{6}$/.test(String(token ?? ''))) {
      throw new AuthFlowError('Le code comporte 6 chiffres.', 'validation', { token: 'Le code comporte 6 chiffres.' });
    }
    const { error } = await client.auth.verifyOtp({ phone, token, type: 'phone_change' });
    if (error) throw new AuthFlowError(messageForAuthError(error), error.code || 'phone_verify_failed');
    return { ok: true };
  }

  /**
   * Complète le profil après une connexion Google (D1, D2) : pseudo, date de naissance, CGU, nom.
   * La base refait toutes les vérifications, y compris l'âge (un mineur n'est jamais enregistré).
   */
  async function completeOnboarding({ username, birthDate, termsAccepted, termsVersion, firstName, lastName }) {
    const u = validateUsername(username);
    if (!u.ok) throw new AuthFlowError(u.message, 'validation', { username: u.message });
    const b = validateBirthDate(birthDate);
    if (!b.ok) throw new AuthFlowError(b.message, 'validation', { birthDate: b.message });
    if (termsAccepted !== true) {
      throw new AuthFlowError('Tu dois accepter les conditions d\'utilisation.', 'validation', { terms: 'Tu dois accepter les conditions d\'utilisation.' });
    }
    if (!termsVersion) throw new AuthFlowError(GENERIC_MESSAGE, 'terms_missing');

    const { error } = await client.rpc('complete_onboarding', {
      p_username: u.value,
      p_birth_date: b.value,
      p_terms_version: termsVersion,
      p_first_name: firstName ?? null,
      p_last_name: lastName ?? null,
    });
    if (error) throw new AuthFlowError(messageForDatabaseError(error), error.code || 'onboarding_failed');
    return { ok: true };
  }

  return {
    isUsernameAvailable, signUp, signIn, signInWithEmail, signInWithUsername, signOut,
    signInWithGoogle, exchangeOAuthCode, requestPhoneVerification, verifyPhoneCode, completeOnboarding,
    requestPasswordReset, confirmEmail, openRecoverySession, setNewPassword,
    requestReauthentication, changePassword, changeEmail, currentUser,
  };
}
