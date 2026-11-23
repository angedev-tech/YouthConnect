// lib/sms/twilio.js — envoi d'un SMS via l'API Twilio (Messages).
//
// Règles :
// - un envoi n'est déclaré accepté que si Twilio renvoie un identifiant de message (sid) ;
//   Twilio n'a pas de clé d'idempotence : le dédoublonnage est fait en base (voir le hook) ;
// - délai maximal court ;
// - aucune erreur ne contient le numéro, le texte, ni le jeton d'authentification.

const TWILIO_URL = 'https://api.twilio.com/2010-04-01/Accounts';

export class SmsProviderError extends Error {
  constructor(message, status = 0, twilioCode = null) {
    super(message);
    this.name = 'SmsProviderError';
    this.status = status;
    this.twilioCode = twilioCode;
  }
}

export async function sendSms({
  accountSid,
  authToken,
  to,
  body,
  from,
  messagingServiceSid,
  timeoutMs = 3500,
  fetchImpl = globalThis.fetch,
}) {
  const form = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
  else form.set('From', from);

  const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${TWILIO_URL}/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    throw new SmsProviderError(err?.name === 'AbortError' ? 'délai dépassé' : 'connexion impossible');
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data.sid !== 'string') {
    throw new SmsProviderError(
      `refusé par le fournisseur (HTTP ${response.status})`,
      response.status,
      typeof data?.code === 'number' ? data.code : null,
    );
  }
  return { sid: data.sid };
}
