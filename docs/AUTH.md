# Authentification : parcours, pages et points d'entrée

Référence : `docs/CAHIER-DES-CHARGES.md` (v2), sections 5 et 6.

## Règle centrale

Un compte n'est **actif** que si l'adresse e-mail est confirmée, le téléphone vérifié, l'âge d'au moins 18 ans atteint, les CGU acceptées et le pseudo choisi. La base recalcule cet état à chaque changement (migration 7). Le navigateur ne peut pas se déclarer actif.

## Les parcours

| Parcours | Où dans le code | Ce qui se passe |
|---|---|---|
| Inscription par e-mail | `js/auth.js` → `signUp` | Validation (dont 18 ans et téléphone obligatoire), vérification du pseudo, création du compte en attente, e-mail de confirmation (hook) |
| Confirmation de l'adresse | `auth/confirm.html` | Le lien valide l'adresse ; le jeton disparaît de la barre d'adresse |
| Vérification du téléphone | `js/auth.js` → `requestPhoneVerification`, `verifyPhoneCode` | Code à 6 chiffres par SMS (hook SMS à écrire), vérification, numéro recopié dans le profil privé |
| Connexion Google | `js/auth.js` → `signInWithGoogle` ; `auth/callback.html` | Redirection vers Google, retour, échange du code, profil à compléter |
| Complétion du profil (Google) | `js/auth.js` → `completeOnboarding` → `complete_onboarding` (base) | Pseudo, date de naissance (18 ans), CGU, nom ; la base refuse un mineur sans rien enregistrer |
| Connexion par e-mail | `signInWithEmail` | Connexion directe à Supabase, CAPTCHA si activé |
| Connexion par pseudo | `api/sign-in.js` | Le serveur retrouve l'e-mail et ouvre la session ; l'e-mail n'est jamais renvoyé |
| Mot de passe oublié | `requestPasswordReset` | E-mail par le hook ; réponse identique que le compte existe ou non |
| Nouveau mot de passe | `auth/reset-password.html` | Jeton validé, mot de passe enregistré, toutes les sessions fermées |
| Déconnexion | `signOut` | Cet appareil uniquement |
| Changement de mot de passe | `changePassword` | Ancien mot de passe vérifié (ou code par e-mail), autres sessions fermées |
| Changement d'adresse | `changeEmail` | Confirmation sur la nouvelle adresse, alerte sur l'ancienne (`old_email`) |

## Points d'entrée serveur

| Route | Méthode | Protection |
|---|---|---|
| `/api/config` | GET | Publique ; ne renvoie que l'adresse du projet et la clé publiable |
| `/api/username-available?username=…` | GET | 30 par minute et par adresse IP |
| `/api/sign-in` | POST | 20 essais par 15 min et par adresse IP ; 5 par 15 min et par identifiant |
| `/api/auth/email-hook` | POST | Signature Standard Webhooks ; e-mails de confirmation, réinitialisation, changement d'adresse, code de reconfirmation, alertes de sécurité |

## Ce qui n'est pas encore fait

- **Pages du site** : accueil, complétion du profil, vérification du téléphone, paramètres. Les fonctions existent, les pages non.
- **Hook SMS** : à écrire, une fois le fournisseur choisi (P1). Sans lui, la vérification du téléphone ne peut pas être testée de bout en bout.
- **Google** : configuration du client OAuth (Google Cloud) et du fournisseur dans Supabase.
- **CAPTCHA** : widget Turnstile non affiché ; ne pas l'activer côté Supabase avant.
- **Suppression du compte** : route serveur à écrire (utilise la clé secrète).

## Règles de sécurité appliquées

- Le mot de passe n'entre jamais dans les métadonnées, ni dans les journaux.
- Les erreurs ne révèlent ni l'existence d'un compte, ni celle d'un pseudo.
- La date de naissance d'un mineur n'est jamais enregistrée (rejet avant écriture).
- Les messages d'erreur de la base sont affichés seulement s'ils sont contrôlés ; les détails techniques ne sortent pas.
- Les sessions sont gérées par la bibliothèque Supabase dans le navigateur ; le site est protégé contre le XSS (échappement).
- Le service worker ne met jamais en cache l'API, les requêtes authentifiées ni les réponses d'un autre site.

## Recette de test de bout en bout

À exécuter sur le projet de test, après les migrations 1 à 8, la configuration Auth et le hook (voir `docs/CONFIGURATION-SUPABASE.md`), et un déploiement Preview. Remplace les valeurs entre `<…>`. Tant que ton domaine n'est pas vérifié, l'adresse de test doit être **celle de ton compte Resend**.

**1. Inscription** (passe par le hook et par la base) :

```bash
curl -X POST "<URL_SUPABASE>/auth/v1/signup" \
  -H "apikey: <CLE_PUBLIABLE>" -H "Content-Type: application/json" \
  -d '{"email":"<ton-adresse-resend>","password":"motdepasse-test-1",
       "data":{"username":"test_inscription","first_name":"Test","last_name":"Inscription",
               "phone":"+22890000000","terms_version":"2026-11-18","birth_date":"1990-05-12"}}'
```

Résultat attendu : un e-mail de confirmation. Sans date de naissance, sans téléphone ou avec moins de 18 ans, la création est refusée.

**2. Confirmation** : ouvre le lien reçu (`<SITE>/auth/confirm?token_hash=…&type=signup`). Le compte reste **en attente** tant que le téléphone n'est pas vérifié.

**3. Pseudo** : `curl "<SITE>/api/username-available?username=test_inscription"` → `{"available":false}`.

**4. Connexion par pseudo** :

```bash
curl -X POST "<SITE>/api/sign-in" -H "Content-Type: application/json" \
  -d '{"identifier":"test_inscription","password":"motdepasse-test-1"}'
```

Résultat attendu : jetons de session et **aucune adresse e-mail** dans la réponse. Tant que le téléphone n'est pas vérifié, le compte ne peut rien publier.

**5. Mot de passe oublié** : demande une réinitialisation, ouvre le lien, choisis un nouveau mot de passe. L'ancien ne fonctionne plus.

**6. Contrôle de la configuration** :

```bash
SUPABASE_URL="<URL_SUPABASE>" SUPABASE_PUBLISHABLE_KEY="<CLE_PUBLIABLE>" npm run check:supabase
```

**7. À faire après le fournisseur SMS et la configuration Google** : vérification du téléphone (code reçu, compte actif), connexion Google (profil à compléter, mineur refusé).

Les étapes 1 à 5 envoient de vrais e-mails et ouvrent de vraies sessions sur ton projet de test. Ne les lance pas sur le projet de production.
