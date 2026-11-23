# Architecture de YouthConnect

## Vue d'ensemble

```
            Navigateur (site YouthConnect : HTML / CSS / JavaScript)
              │                                       │
              │ lit et écrit avec la clé publiable     │ /api/config, /api/username-available
              │ (RLS : la base décide ce qui est permis)│
              ▼                                       ▼
   ┌──────────────────────┐              ┌──────────────────────────────┐
   │ Supabase             │              │ Vercel : fonctions /api      │
   │  • Auth (comptes)    │◀─ hook ──────│  • /api/auth/email-hook      │
   │  • PostgreSQL + RLS  │              │  • /api/username-available   │
   │  • Limites de débit  │              │  • /api/config               │
   └──────────────────────┘              └──────────────┬───────────────┘
                                                        │ clé secrète / clé Resend
                                                        ▼
                                              ┌──────────────────┐
                                              │ Resend (e-mails) │
                                              └──────────────────┘
```

Trois zones, trois niveaux de confiance :

1. **Navigateur** : ne détient que des valeurs publiques (adresse du projet, clé publiable). Il ne décide de rien : tout ce qui compte est vérifié par la base ou par le serveur.
2. **Base Supabase** : seule source de vérité. La RLS et les droits de colonnes décident de ce que chaque visiteur, membre, modérateur ou administrateur peut lire ou écrire.
3. **Fonctions Vercel** : seules à détenir les secrets (clé secrète, clé Resend, secret du hook). Elles sont sans état : n'importe quelle instance peut répondre.

## Composants

| Composant | Responsabilité | Fichiers |
|---|---|---|
| Site (navigateur) | Interface, design YouthConnect | `index.html`, `style.css`, `script.js`, `sw.js`, `manifest.json` |
| Configuration | Lecture et validation des variables, règles par environnement | `lib/env.js` |
| Reconnaissance des clés | Refuse une clé secrète côté public | `lib/keys.js` |
| Hook e-mail | Reçoit les e-mails d'authentification, vérifie la signature, envoie | `api/auth/email-hook.js` |
| Modèles d'e-mails | Gabarit commun, messages en français, échappement | `lib/email/templates.js`, `lib/email/auth-messages.js` |
| Envoi | Appel de l'API Resend, idempotence, délai maximal | `lib/email/resend.js` |
| Vérification de signature | Standard Webhooks, tolérance de 5 minutes | `lib/webhooks.js` |
| Limitation de débit | Compteurs atomiques en base, IP hachée | `lib/ratelimit.js`, migration 5 |
| Vérification de pseudo | Route limitée par IP | `api/username-available.js` |
| Connexion par pseudo | Résolution serveur, jetons seulement | `api/sign-in.js`, migration 6 |
| Authentification (navigateur) | Parcours, validation, messages | `js/auth.js`, `js/validation.js`, `js/messages.js` |
| Pages des liens e-mail | Confirmation et nouveau mot de passe | `auth/confirm.html`, `auth/reset-password.html` |
| Service worker | Cache limité aux fichiers statiques du site | `sw.js` |
| Contrôle DNS | Vérifie SPF, DKIM, DMARC et MX de rebond d'un domaine | `lib/email/dns-check.js`, `scripts/email-dns-check.mjs` |
| Base de données | Schéma, RLS, règles métier, notifications, modération | `supabase/migrations/` |

## Flux principaux

### Inscription

1. Le formulaire envoie les informations à Supabase Auth (adresse, mot de passe, et dans les métadonnées : pseudo, prénom, nom, téléphone, version des CGU).
2. Un déclencheur en base crée le profil public, les données privées et le rôle « membre », **après avoir revalidé** pseudo, téléphone et CGU. Une donnée invalide fait échouer l'inscription entière.
3. Supabase demande la confirmation de l'adresse et appelle le hook.
4. Le hook vérifie la signature, construit le message, l'envoie via Resend, puis répond.
5. Le membre clique sur le lien (`APP_URL/auth/confirm?token_hash=…`) ; la page appellera Supabase pour valider le jeton.

### Vérification du pseudo (pendant la saisie)

Le navigateur appelle `/api/username-available`. La route applique d'abord la limite par IP (30 vérifications par minute), puis interroge la base avec la clé secrète. Les formats invalides reçoivent une réponse sans appel à la base.

### Publication, réponse, réaction

Le navigateur écrit directement dans la base avec la clé publiable. La RLS n'autorise que les écritures au nom du membre connecté, sur un compte actif, dans une question ouverte. Les déclencheurs ajoutent les notifications et appliquent les limites anti-spam. Le membre ne peut ni choisir son auteur, ni se masquer, ni créer une notification pour un autre.

### Signalement et modération

Un signalement est créé en base : l'auteur signalé est déduit par la base (le navigateur ne peut pas le choisir), les doublons et les contenus propres sont refusés. Seule l'équipe peut le traiter, par une fonction qui vérifie son rôle elle-même.

## Sécurité en couches

| Couche | Protection |
|---|---|
| Secrets | Clé secrète, clé Resend et secret du hook uniquement sur Vercel ; route `/api/config` qui refuse une clé secrète ; test qui scanne les fichiers du site |
| Transport | https obligatoire en production ; en-têtes `X-Frame-Options: DENY`, `nosniff`, politique de référent |
| Appels entrants | Signature Standard Webhooks sur le corps brut, tolérance de 5 minutes, comparaison à temps constant |
| Base : accès | Droits par défaut fermés ; droits explicites colonne par colonne ; `security definer` avec `search_path` fixé |
| Base : données | RLS sur toutes les tables ; contraintes de format (pseudo, téléphone E.164, liens internes, images Cloudinary) |
| Base : rôles | Rôles dans une table séparée ; attribution par fonction ; au moins un administrateur en permanence |
| Journaux | Sans adresse e-mail, sans lien, sans jeton, sans clé ; journal de sécurité en base, lisible par les administrateurs |
| Tests | 144 tests unitaires et de sécurité, 65 tests de base (RLS, droits, limites, simultanéité, connexion par pseudo) |

## Anti-spam et tentatives répétées

| Menace | Réponse | Où |
|---|---|---|
| Inscriptions automatiques | CAPTCHA Turnstile, confirmation par e-mail, pseudo et téléphone uniques | Supabase (à activer, voir CONFIGURATION-SUPABASE.md) |
| Énumération des pseudos | Vérification limitée à 30 par minute et par IP | `/api/username-available` |
| Publications en rafale | 5 questions, 30 réponses, 60 commentaires par heure et par membre | Déclencheurs en base |
| Signalements abusifs | 10 signalements par heure ; un contenu ne se signale qu'une fois ; contenu propre refusé | Base |
| Mots de passe devinés | Limites de tentatives et CAPTCHA sur la connexion | Supabase Auth (à régler et tester) |
| Rejeu d'appel du hook | Horodatage limité à 5 minutes | `lib/webhooks.js` |
| Envoi multiple d'un même e-mail | Clé d'idempotence Resend, dérivée de l'identifiant d'appel | `lib/email/resend.js` |
| Abus d'e-mails | Un message par action ; le hook refuse les types non prévus | `lib/email/auth-messages.js` |

Les compteurs de débit échouent **fermés** : si la base ne répond pas, la requête est refusée plutôt que laissée passer.

## Environnements

| Environnement | Supabase | Domaine d'envoi | Clé Resend |
|---|---|---|---|
| Development (local) | Projet de test | `resend.dev` (test) | Clé de test |
| Preview (branches) | Projet de test | `resend.dev` ou sous-domaine de test | Clé de test |
| Production | Projet de production (Pro) | Domaine vérifié | Clé de production |

`resend.dev` est refusé automatiquement en production. Le code ne décide pas du domaine : c'est la configuration de l'environnement.

## Choix techniques

- **Fonctions Vercel plutôt qu'un serveur dédié.** Pas de machine à entretenir, mise à l'échelle automatique, déploiement par Git. Les fonctions sont sans état : les compteurs de débit sont donc en base, pas en mémoire.
- **Format « Web standard » pour les fonctions** (`export default { fetch(request) }`). Sur Vercel, le corps d'une requête Node est parsé automatiquement, ce qui rend la vérification de signature peu fiable. Ce format donne le corps brut exact via `request.text()`.
- **Hook d'e-mail Supabase plutôt que SMTP seul.** Les modèles, la journalisation et la vérification restent dans le dépôt, versionnés et testés. Le changement de domaine ne touche pas au code.
- **Resend.** Interface simple, clés d'idempotence, plan gratuit pour les tests, plan Pro à partir de 20 $/mois pour 50 000 e-mails sans plafond journalier.
- **Supabase.** Auth, base relationnelle, RLS et fonctions dans un même service. Le plan gratuit suffit pour les tests ; la production demande le plan Pro, qui évite la mise en pause.
- **Pas de framework côté site (pour l'instant).** Le design et le code existants sont conservés. Une migration vers un framework pourra être envisagée plus tard, si le besoin le justifie.

## Évolutivité

- **Base** : index sur les colonnes filtrées (catégorie, auteur, date, recherche plein texte). Les compteurs publics sont des vues agrégées, pas des lectures de toutes les lignes.
- **Limites de débit** : la purge (`purge_rate_limits`) doit être planifiée côté serveur, sinon la table grossit sans fin. Elle est prête mais pas encore planifiée.
- **Trafic élevé** : si les compteurs deviennent un goulot d'étranglement, ils pourront migrer vers un stockage en mémoire dédié, sans changer le reste.
- **Front** : le chargement de toutes les questions d'un coup ne tiendra pas à grande échelle. La pagination est prévue dans la phase suivante.

## Limites connues

- Les règles de la base et les limites Supabase Auth n'ont été testées que sur un PostgreSQL local qui imite le schéma `auth`. La validation sur un vrai projet Supabase de test reste à faire (voir plus bas).
- Le hook et Resend ne sont testés qu'avec des requêtes simulées. Le premier envoi réel demande une clé Resend et une adresse de test.
- La route du hook n'a pas été exécutée sur Vercel : la lecture du corps brut est conforme à la documentation, mais elle doit être confirmée au premier déploiement.
- Les notifications push de l'ancienne version (`/api/send-push`) ne font pas partie de cette architecture. Elles seront réécrites ou retirées avec le front.
- Si un proxy est ajouté devant Vercel (par exemple Cloudflare), la lecture de l'adresse IP devra être adaptée (`lib/http.js`).

## Prochaines étapes

1. **Projet de test Supabase** : appliquer les migrations, configurer Auth (voir CONFIGURATION-SUPABASE.md), et exécuter les tests de base contre ce projet.
2. **Front** : client Supabase avec la clé publiable (récupérée via `/api/config`), pages d'inscription, de connexion, de confirmation et de réinitialisation, validation du formulaire identique aux règles de la base.
3. **CAPTCHA** côté formulaires, une fois la clé de site Turnstile créée.
4. **Accueil, forum, profils, notifications, administration** branchés sur la base, sans données de démonstration.
5. **Codes SMS** (test vers un numéro +228 avant le choix du fournisseur).
6. **Migration des données** de l'ancienne version, après accord écrit.
7. **Déploiement** sur le projet Vercel de test, puis production.
