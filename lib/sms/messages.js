// lib/sms/messages.js — texte des SMS de vérification YouthConnect.

export function smsText({ code }) {
  return `YouthConnect : ton code de vérification est ${code}. Ne le partage avec personne.`;
}