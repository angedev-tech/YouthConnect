// lib/email/resend.js — envoi d'un e-mail via l'API Resend.
//
// Règles :
// - un envoi n'est déclaré réussi que si Resend renvoie un identifiant d'e-mail ;
// - la clé d'idempotence évite qu'un nouvel essai envoie le même e-mail deux fois (valable 24 h chez Resend) ;
// - délai maximal court, pour rester sous la limite du hook Supabase ;
// - aucune erreur ne contient la clé API ni le contenu du message.

const RESEND_URL = 'https://api.resend.com/emails';

export class EmailProviderError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'EmailProviderError';
    this.status = status;
  }
}

export async function sendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
  text,
  idempotencyKey,
  timeoutMs = 3500,
  fetchImpl = globalThis.fetch,
}) {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, 256);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new EmailProviderError(err?.name === 'AbortError' ? 'délai dépassé' : 'connexion impossible');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new EmailProviderError(`refusé par le fournisseur (HTTP ${response.status})`, response.status);
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data.id !== 'string') {
    throw new EmailProviderError('réponse inattendue du fournisseur', response.status);
  }
  return { id: data.id };
}
