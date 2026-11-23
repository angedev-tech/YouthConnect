// Page /auth/reset-password : ouvre la session de réinitialisation puis enregistre le nouveau mot de passe.
import { getSupabase } from '../client.js';
import { createAuth } from '../auth.js';
import { parseAuthLinkParams } from '../auth-links.js';

const titre = document.getElementById('titre');
const message = document.getElementById('message');
const formulaire = document.getElementById('formulaire');
const bouton = document.getElementById('bouton');
const champMotDePasse = document.getElementById('mot-de-passe');
const champConfirmation = document.getElementById('confirmation');
const erreurMotDePasse = document.getElementById('erreur-mot-de-passe');
const erreurConfirmation = document.getElementById('erreur-confirmation');
const erreurGenerale = document.getElementById('erreur-generale');
const suite = document.getElementById('suite');

function effacerErreurs() {
  erreurMotDePasse.textContent = '';
  erreurConfirmation.textContent = '';
  erreurGenerale.textContent = '';
}

function terminer(titreTexte, texte) {
  titre.textContent = titreTexte;
  message.textContent = texte;
  formulaire.hidden = true;
  suite.hidden = false;
}

(async () => {
  let lien;
  try {
    lien = parseAuthLinkParams(location.search, ['recovery']);
  } catch {
    terminer('Lien invalide', 'Ce lien est incomplet ou mal copié. Demande un nouveau lien depuis la page de connexion.');
    return;
  }
  history.replaceState(null, '', location.pathname);

  let auth;
  let adresse = '';
  try {
    auth = createAuth({ client: await getSupabase() });
    await auth.openRecoverySession({ tokenHash: lien.tokenHash });
    adresse = (await auth.currentUser())?.email || '';
  } catch (err) {
    terminer('Lien expiré ou déjà utilisé', `${err.message || ''} Demande un nouveau lien depuis la page de connexion.`.trim());
    return;
  }

  message.textContent = 'Choisis un nouveau mot de passe, d\'au moins 10 caractères.';
  formulaire.hidden = false;

  formulaire.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    effacerErreurs();
    bouton.disabled = true;
    try {
      await auth.setNewPassword({
        password: champMotDePasse.value,
        confirmation: champConfirmation.value,
        email: adresse,
      });
      terminer('Mot de passe modifié', 'Tu peux maintenant te connecter avec ton nouveau mot de passe.');
    } catch (err) {
      const champs = err.fields || {};
      erreurMotDePasse.textContent = champs.password || '';
      erreurConfirmation.textContent = champs.passwordConfirmation || '';
      if (!champs.password && !champs.passwordConfirmation) erreurGenerale.textContent = err.message;
    } finally {
      bouton.disabled = false;
    }
  });
})();
