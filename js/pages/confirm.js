import { getSupabase } from '../client.js';
import { createAuth } from '../auth.js';
import { parseAuthLinkParams } from '../auth-links.js';

const message = document.getElementById('auth-message');
const status = document.getElementById('auth-status');

async function confirmAccount() {
  try {
    const { tokenHash, type } = parseAuthLinkParams(
      window.location.search,
      ['signup', 'email_change']
    );

    // Retire les paramètres sensibles de l'adresse affichée.
    window.history.replaceState({}, document.title, window.location.pathname);

    const client = await getSupabase();
    const auth = createAuth({ client });

    await auth.confirmEmail({ tokenHash, type });

    message.textContent = 'Confirmation réussie.';
    status.textContent = type === 'signup'
      ? 'Ton adresse e-mail est confirmée. Tu peux maintenant revenir sur YouthConnect et te connecter.'
      : 'Ton changement d’adresse e-mail est confirmé.';
  } catch (error) {
    console.error('Erreur de confirmation :', error?.code || 'confirmation_failed');

    message.textContent = 'Le lien ne peut pas être confirmé.';
    status.textContent = error?.message ||
      'Ce lien est invalide ou expiré. Demande un nouveau lien de confirmation.';
    status.classList.add('auth-error');
  }
}

confirmAccount();
