// js/client.js — client Supabase du navigateur (seul fichier qui charge la bibliothèque).
// Version épinglée : une mise à jour se fait ici, volontairement, après vérification.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { loadPublicConfig } from './config.js';

let clientPromise = null;

/** Un seul client pour toute la page. La session est gérée par la bibliothèque. */
export function getSupabase() {
  if (!clientPromise) {
    clientPromise = loadPublicConfig().then((config) =>
      createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false, // les liens e-mail sont traités par nos pages, pas automatiquement
          flowType: 'pkce', // retour de Google : échange d'un code à usage unique
        },
      }),
    );
  }
  return clientPromise;
}
