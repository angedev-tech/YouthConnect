#!/usr/bin/env node
// Usage : npm run dns:check -- mail.ton-domaine.fr
// Lit les enregistrements DNS publics et indique ce qui manque pour l'envoi d'e-mails.
// N'envoie rien et ne modifie rien.

import { promises as dns } from 'node:dns';
import { checkEmailDns } from '../lib/email/dns-check.js';

const domain = process.argv[2];
if (!domain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
  console.error('Usage : npm run dns:check -- mail.ton-domaine.fr');
  process.exit(2);
}

let results;
try {
  results = await checkEmailDns(domain, dns);
} catch (err) {
  console.error(`Vérification impossible : le DNS n'a pas répondu correctement (${err?.code || err?.message || 'erreur inconnue'}).`);
  console.error('Réessaie plus tard, ou depuis un réseau qui autorise les requêtes DNS.');
  process.exit(1);
}
const width = Math.max(...results.map((r) => r.check.length));

console.log(`Vérification DNS pour ${domain}\n`);
for (const r of results) {
  const mark = r.status === 'ok' ? '✔' : '✘';
  console.log(`${mark} ${r.check.padEnd(width)}  ${r.host}  →  ${r.detail}`);
}

const missing = results.filter((r) => r.status !== 'ok');
console.log(
  missing.length === 0
    ? '\nTout est en place. Vérifie maintenant le domaine dans Resend (bouton « Verify DNS Records »).'
    : `\n${missing.length} élément(s) à créer ou corriger. Copie les valeurs exactes affichées par Resend ` +
        '(onglet Records), car elles peuvent différer selon ton domaine. Voir docs/EMAIL-ET-DOMAINE.md.',
);
