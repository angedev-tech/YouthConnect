// lib/sms/messages.js — texte des SMS. Court (une seule partie), sans lien, sans nom.

export function smsText({ type, code }) {
  if (type === 'reauthentication') {
    return `YouthConnect : ton code de confirmation est ${code}. Si ce n'est pas toi, ignore ce message.`;
  }
  return `YouthConnect : ton code de vérification est ${code}. Ne le partage avec personne.`;
}
