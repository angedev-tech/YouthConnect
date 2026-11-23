// lib/email/templates.js — gabarit commun et messages d'authentification.
// Toute donnée insérée dans le HTML passe par escapeHtml. Aucune image externe (pas de suivi des lecteurs).

const BRAND = { name: 'YouthConnect', navy: '#1a1a2e', blue: '#2563eb', text: '#1f2937', muted: '#6b7280', bg: '#f4f6fb' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Construit un e-mail complet.
 * @param {{subject: string, preheader?: string, heading: string, paragraphs: string[],
 *          action?: {label: string, url: string}, footnote?: string}} content
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderEmail({ subject, preheader = '', heading, paragraphs, action, footnote = '' }) {
  const paragraphHtml = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${BRAND.text}">${escapeHtml(p)}</p>`)
    .join('');

  const buttonHtml = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td>
         <a href="${escapeHtml(action.url)}" style="display:inline-block;background:${BRAND.blue};color:#ffffff;
            text-decoration:none;font-weight:600;font-size:16px;padding:14px 26px;border-radius:10px">${escapeHtml(action.label)}</a>
       </td></tr></table>
       <p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:${BRAND.muted}">
         Si le bouton ne fonctionne pas, copie cette adresse dans ton navigateur :<br>
         <span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : '';

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
  <tr><td style="background:${BRAND.navy};padding:22px 28px">
    <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:.2px">${BRAND.name}</span><br>
    <span style="color:#c7d2fe;font-size:13px">Partager · Apprendre · Grandir ensemble</span>
  </td></tr>
  <tr><td style="padding:28px">
    <h1 style="margin:0 0 16px;font-size:22px;color:${BRAND.navy}">${escapeHtml(heading)}</h1>
    ${paragraphHtml}
    ${buttonHtml}
    ${footnote ? `<p style="margin:0;font-size:13px;line-height:1.5;color:${BRAND.muted}">${escapeHtml(footnote)}</p>` : ''}
  </td></tr>
  <tr><td style="padding:16px 28px;background:#f9fafb;font-size:12px;color:${BRAND.muted}">
    Message automatique envoyé par ${BRAND.name}. Merci de ne pas répondre à cet e-mail.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    heading,
    '',
    ...paragraphs,
    ...(action ? ['', `${action.label} : ${action.url}`] : []),
    ...(footnote ? ['', footnote] : []),
    '',
    `L'équipe ${BRAND.name}`,
  ].join('\n');

  return { subject, html, text };
}

/** Lien de confirmation ou de réinitialisation : token_hash et type, encodés. */
export function authLink(appUrl, path, tokenHash, type) {
  const params = new URLSearchParams({ token_hash: tokenHash, type });
  return `${appUrl}${path}?${params.toString()}`;
}

export const signupMessage = ({ url }) =>
  renderEmail({
    subject: 'Confirme ton adresse e-mail — YouthConnect',
    preheader: 'Un dernier clic pour activer ton compte.',
    heading: 'Bienvenue sur YouthConnect !',
    paragraphs: ['Il ne reste qu\'une étape : confirme ton adresse e-mail pour activer ton compte.'],
    action: { label: 'Confirmer mon adresse', url },
    footnote: 'Si tu n\'as pas créé de compte, tu peux ignorer ce message.',
  });

export const recoveryMessage = ({ url }) =>
  renderEmail({
    subject: 'Réinitialise ton mot de passe — YouthConnect',
    preheader: 'Choisis un nouveau mot de passe.',
    heading: 'Mot de passe oublié ?',
    paragraphs: [
      'Clique sur le bouton ci-dessous pour choisir un nouveau mot de passe.',
      'Ce lien ne fonctionne qu\'une seule fois et expire rapidement.',
    ],
    action: { label: 'Choisir un nouveau mot de passe', url },
    footnote: 'Si tu n\'es pas à l\'origine de cette demande, ignore cet e-mail : ton mot de passe reste inchangé.',
  });

export const emailChangeCurrentMessage = ({ url }) =>
  renderEmail({
    subject: 'Demande de changement d\'adresse e-mail — YouthConnect',
    preheader: 'Confirme le changement depuis ton adresse actuelle.',
    heading: 'Changement d\'adresse e-mail',
    paragraphs: [
      'Une demande de changement de l\'adresse e-mail de ton compte YouthConnect vient d\'être faite.',
      'Pour la confirmer, clique sur le bouton ci-dessous.',
    ],
    action: { label: 'Confirmer le changement', url },
    footnote: 'Si ce n\'est pas toi, ne clique pas sur le lien et change ton mot de passe.',
  });

export const reauthenticationMessage = ({ code }) =>
  renderEmail({
    subject: 'Ton code de confirmation — YouthConnect',
    preheader: `Code de confirmation : ${code}`,
    heading: 'Confirme que c\'est bien toi',
    paragraphs: [
      'Saisis ce code sur YouthConnect pour confirmer ta demande :',
      `Code : ${code}`,
      'Ce code expire rapidement et ne fonctionne qu\'une fois.',
    ],
    footnote: 'Si tu n\'es pas à l\'origine de cette demande, ignore cet e-mail et change ton mot de passe.',
  });

export const passwordChangedMessage = () =>
  renderEmail({
    subject: 'Ton mot de passe a été modifié — YouthConnect',
    preheader: 'Le mot de passe de ton compte vient d\'être modifié.',
    heading: 'Ton mot de passe a été modifié',
    paragraphs: ['Le mot de passe de ton compte YouthConnect vient d\'être modifié.'],
    footnote: 'Si ce n\'est pas toi, utilise « Mot de passe oublié » sur la page de connexion, et contacte l\'équipe YouthConnect.',
  });

export const emailChangedNotificationMessage = () =>
  renderEmail({
    subject: 'Ton adresse e-mail a été modifiée — YouthConnect',
    preheader: 'L\'adresse e-mail de ton compte vient d\'être modifiée.',
    heading: 'Ton adresse e-mail a été modifiée',
    paragraphs: ['L\'adresse e-mail de ton compte YouthConnect vient d\'être modifiée.'],
    footnote: 'Si ce n\'est pas toi, contacte l\'équipe YouthConnect immédiatement.',
  });

export const emailChangeNewMessage = ({ url }) =>
  renderEmail({
    subject: 'Confirme ta nouvelle adresse e-mail — YouthConnect',
    preheader: 'Confirme que cette adresse est bien la tienne.',
    heading: 'Nouvelle adresse e-mail',
    paragraphs: [
      'Tu as demandé à utiliser cette adresse pour ton compte YouthConnect.',
      'Clique sur le bouton ci-dessous pour la confirmer.',
    ],
    action: { label: 'Confirmer cette adresse', url },
    footnote: 'Si tu n\'es pas à l\'origine de cette demande, ignore cet e-mail.',
  });
