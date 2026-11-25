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

async function initialiserReinitialisation() {
  let lien;

  try {
    lien = parseAuthLinkParams(window.location.search, ['recovery']);
  } catch {
    terminer(
      'Lien invalide',
      'Ce lien est incomplet ou mal copié. Demande un nouveau lien depuis la page de connexion.'
    );
    return;
  }

  // Retire le token de l'adresse affichée après sa lecture.
  window.history.replaceState({}, document.title, window.location.pathname);

  let auth;
  let adresse = '';

  try {
    auth = createAuth({ client: await getSupabase() });
    await auth.openRecoverySession({ tokenHash: lien.tokenHash });

    adresse = (await auth.currentUser())?.email || '';

    if (!adresse) {
      throw new Error('La session de réinitialisation est invalide. Demande un nouveau lien.');
    }
  } catch (error) {
    console.error('Ouverture de session de récupération impossible :', error?.code || 'recovery_failed');
    terminer(
      'Lien invalide ou expiré',
      error?.message || 'Demande un nouveau lien de réinitialisation depuis la page de connexion.'
    );
    return;
  }

  message.textContent = 'Le lien est valide. Choisis un nouveau mot de passe d’au moins 10 caractères.';
  formulaire.hidden = false;

  formulaire.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    effacerErreurs();

    if (!formulaire.reportValidity()) return;

    bouton.disabled = true;

    try {
      await auth.setNewPassword({
        password: champMotDePasse.value,
        confirmation: champConfirmation.value,
        email: adresse,
      });

      terminer(
        'Mot de passe modifié',
        'Ton mot de passe a été modifié. Tu peux maintenant te connecter avec ton nouveau mot de passe.'
      );
    } catch (error) {
      const champs = error.fields || {};

      erreurMotDePasse.textContent = champs.password || '';
      erreurConfirmation.textContent = champs.passwordConfirmation || '';

      if (!champs.password && !champs.passwordConfirmation) {
        erreurGenerale.textContent = error.message || 'La modification a échoué. Réessaie.';
      }
    } finally {
      bouton.disabled = false;
    }
  });
}

initialiserReinitialisation();
