// Page /auth/callback : retour de la connexion Google. Le code est échangé une seule fois.
import { getSupabase } from '../client.js';
import { createAuth } from '../auth.js';

const titre = document.getElementById('titre');
const message = document.getElementById('message');
const suite = document.getElementById('suite');

function afficher(titreTexte, texte) {
  titre.textContent = titreTexte;
  message.textContent = texte;
  suite.hidden = false;
}

(async () => {
  const code = new URLSearchParams(location.search).get('code') || '';
  // Le code disparaît de la barre d'adresse et de l'historique dès qu'il est lu
  history.replaceState(null, '', location.pathname);
  try {
    const auth = createAuth({ client: await getSupabase() });
    await auth.exchangeOAuthCode({ code });
    afficher('Connexion réussie', 'Il reste à compléter ton profil (pseudo, date de naissance, téléphone) pour activer ton compte.');
  } catch (err) {
    afficher('Connexion impossible', err.message || 'Une erreur est survenue. Réessaie depuis la page de connexion.');
  }
})();
