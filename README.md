# YouthConnect

Plateforme d'entraide entre jeunes : partager, apprendre, grandir ensemble.

## État d'avancement

| Partie | État |
|---|---|
| Base de données (schéma, RLS, règles métier, limites de débit, connexion par pseudo) | ✅ Prête, 94 tests passent sur PostgreSQL local |
| Envoi d'e-mails d'authentification (hook Supabase → Resend) | ✅ Prêt, testé (requêtes simulées) |
| Envoi des SMS de vérification (hook Supabase → Twilio) | ✅ Prêt, testé (requêtes simulées) ; à vérifier avec un numéro +228 |
| Sécurité : secrets, signature, limites, anti-spam, service worker | ✅ Prête, 181 tests passent |
| Contrôle DNS du domaine (SPF, DKIM, DMARC) | ✅ Prêt, à utiliser le jour où tu achètes ton domaine |
| Authentification : modules, pages de confirmation et de nouveau mot de passe, connexion par pseudo | ✅ Prête, testée sur la logique (pas encore branchée sur l'accueil) |
| Site : accueil, forum, profils, notifications, administration | ⏳ À brancher sur Supabase (prochaine étape) |
| Codes SMS | ⏳ Après un test réel vers un numéro +228 |
| Migration des données de l'ancienne version | ⏳ Après accord écrit |

## Commandes

```bash
npm install            # dépendances
npm test               # tests unitaires et de sécurité (sans base ni réseau)
npm run test:db        # tests de la base (PostgreSQL local, recréé à chaque fois)
npm run dns:check -- mail.ton-domaine.fr   # contrôle DNS d'un domaine d'envoi
npm run check:supabase # contrôle de ton projet Supabase (clé publiable seulement)
```

`test:db` supprime et recrée une base locale nommée `yc_test`. Il refuse tout hôte autre que `localhost`.

## Structure

```
api/                   fonctions Vercel (configuration, hook e-mail, vérification de pseudo)
lib/                   code partagé : configuration, clés, signatures, e-mails, limites
supabase/migrations/   schéma et règles de la base, dans l'ordre
supabase/tests/        imitation locale du schéma auth (tests uniquement)
tests/unit/            tests unitaires
tests/security/        garde-fou : aucun secret dans les fichiers du site
tests/db/              tests de la base (RLS, droits, limites)
scripts/               outils (tests de base, contrôle DNS)
docs/                  documentation (architecture, e-mails et domaine, secrets, Supabase)
index.html, style.css, script.js, sw.js, manifest.json, icônes
                       le site (version d'origine, pas encore branchée sur Supabase)
```

## Mise en place

Ordre recommandé :

1. **Supabase (test)** : créer le projet, appliquer les migrations, configurer Auth. Voir [docs/CONFIGURATION-SUPABASE.md](docs/CONFIGURATION-SUPABASE.md).
2. **Vercel** : créer le projet, renseigner les variables (modèle : `.env.example`). Voir [docs/SECRETS.md](docs/SECRETS.md).
3. **Resend** : créer la clé de test. Pour l'instant, l'expéditeur de test ne livre qu'à l'adresse de ton compte. Voir [docs/EMAIL-ET-DOMAINE.md](docs/EMAIL-ET-DOMAINE.md).
4. **Test** : une inscription doit envoyer un e-mail de confirmation à l'adresse de ton compte Resend.
5. **Domaine** (plus tard) : suivre la procédure de [docs/EMAIL-ET-DOMAINE.md](docs/EMAIL-ET-DOMAINE.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) : composants, flux, sécurité, anti-spam, choix techniques, limites.
- [E-mails et domaine](docs/EMAIL-ET-DOMAINE.md) : test sans domaine, sous-domaine gratuit, procédure DNS.
- [Clés et secrets](docs/SECRETS.md) : ce qui va où, interdits, rotation.
- [Configuration Supabase](docs/CONFIGURATION-SUPABASE.md) : réglages du tableau de bord, pas à pas.
- [Cahier des charges v2](docs/CAHIER-DES-CHARGES.md) : décisions validées, exigences, données personnelles, critères d'acceptation.
- [Authentification](docs/AUTH.md) : parcours, pages, points d'entrée, recette de test de bout en bout.
- [Prêt à lancer](docs/PRET-A-LANCER.md) : état et tâches restantes, avec le responsable de chacune.

## Règles de sécurité

- Aucune clé secrète dans le navigateur, le code ou GitHub. Un test automatique le vérifie.
- Toute modification de la base passe par une migration et doit garder les tests au vert.
- Les données personnelles (prénom, nom, téléphone) ne sont jamais publiques.
