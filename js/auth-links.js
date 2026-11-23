// js/auth-links.js — lecture des paramètres des liens reçus par e-mail (/auth/confirm, /auth/reset-password).
// Le jeton n'est jamais affiché ni journalisé ; seul le format est vérifié avant utilisation.

const HASH_RE = /^[a-f0-9]{32,128}$/;

/**
 * @param {string} search  la partie « ?… » de l'adresse
 * @param {string[]} allowedTypes  types acceptés par cette page
 * @returns {{tokenHash: string, type: string}}
 * @throws {Error} si le lien est incomplet, mal formé ou d'un type non attendu
 */
export function parseAuthLinkParams(search, allowedTypes) {
  const params = new URLSearchParams(search);
  const tokenHash = params.get('token_hash') || '';
  const type = params.get('type') || '';
  if (!HASH_RE.test(tokenHash)) throw new Error('Lien incomplet ou invalide.');
  if (!allowedTypes.includes(type)) throw new Error('Lien incomplet ou invalide.');
  return { tokenHash, type };
}
