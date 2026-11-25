// api/config.js — configuration publique pour le navigateur.
//
// Ne renvoie QUE : l'adresse du projet Supabase, la clé publiable et le nom de l'environnement.
// Si la variable publique contient une clé secrète, la fonction refuse de répondre
// (la valeur n'est jamais affichée ni journalisée).

import { ConfigError } from '../lib/errors.js';
import { publicConfig } from '../lib/env.js';
import { json } from '../lib/http.js';

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return json({ error: 'Méthode non autorisée.' }, 405, { Allow: 'GET' });
    }
    try {
      const config = publicConfig(process.env);
      return json(config, 200, { 'Cache-Control': 'public, max-age=60, s-maxage=300' });
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(`Configuration publique invalide : ${err.message}`);
        return json({ error: 'Configuration du serveur incomplète.' }, 500);
      }
      throw err;
    }
  },
};
