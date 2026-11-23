// lib/errors.js — erreurs partagées par le serveur.
// Règle : un message d'erreur ne contient JAMAIS une clé, un secret ou une adresse e-mail.

/** Configuration absente ou invalide (variable manquante, clé au mauvais format…). */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Erreur à renvoyer telle quelle au client, avec son code HTTP. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
