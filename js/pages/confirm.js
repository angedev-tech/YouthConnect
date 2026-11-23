// Page /auth/confirm : valide le lien de confirmation (inscription ou changement d'adresse).
import { getSupabase } from '../client.js';
import { createAuth } from '../auth.js';
import { parseAuthLinkParams } from '../auth-links.js';

const titre = document.getElementById('titre');
const message = document.getElementById('message');
const suite = document.getElementById('suite');

function afficher(titreTexte, texte) {
  titre.textContent = titreTexte;
  message.textContent = texte;
  suite.hidden = false;
}

(async () => {
  let lien;
  try {
    lien = parseAuthLinkParams(location.search, ['signup', 'email_change']);
  } catch {
    afficher('Lien invalide', 'Ce lien est incomplet ou mal copié. Demande un nouveau lien depuis YouthConnect.');
    return;
  }
  // Le jeton disparaît de la barre d'adresse et de l'historique dès qu'il est lu
  history.replaceState(null, '', location.pathname);

  try {
    const auth = createAuth({ client: await getSupabase() });
    await auth.confirmEmail(lien);
    afficher(
      lien.type === 'signup' ? 'Adresse confirmée !' : 'Adresse mise à jour !',
      'Ton compte est prêt. Tu peux maintenant utiliser YouthConnect.',
    );
  } catch (err) {
    afficher('Confirmation impossible', err.message || 'Une erreur est survenue. Réessaie.');
  }
})();
