# Configurer Supabase, pas à pas

Ce guide décrit ce que tu règles dans le tableau de bord Supabase. Les intitulés exacts des menus peuvent évoluer : si un libellé diffère, cherche la section correspondante.

## 0. Deux projets, pas un

| Projet | Usage | Plan |
|---|---|---|
| **Test** | Développement, essais | Gratuit (mis en pause après 7 jours sans activité) |
| **Production** | Vrais membres | **Pro** (25 $/mois, jamais mis en pause) |

Ne mélange jamais les deux : les environnements Preview de Vercel pointent vers le projet de test, Production vers le projet de production.

## 1. Base de données

1. Ouvre l'**éditeur SQL** du projet.
2. Exécute les migrations **dans l'ordre**, de `20261118100000_schema.sql` à `20261118100700_sms_deliveries.sql` (huit fichiers). Chacun est dans `supabase/migrations/`.
3. **N'exécute jamais** `supabase/tests/shim/auth_shim.sql` : il ne sert qu'aux tests locaux, le schéma `auth` existe déjà sur Supabase.
4. Crée le **premier administrateur**, une seule fois, avec l'identifiant de son compte (visible dans *Authentication → Users*) :
   ```sql
   insert into public.user_roles (user_id, role_id) values ('UUID-DU-COMPTE', 3);
   ```
   Le rôle 3 est « admin », le rôle 2 « moderator ».

## 2. Clés d'API

*Settings → API Keys* :

- la **clé publiable** (`sb_publishable_…`) → Vercel, variable `SUPABASE_PUBLISHABLE_KEY` ;
- la **clé secrète** (`sb_secret_…`) → Vercel uniquement, variable `SUPABASE_SECRET_KEY`.

Ne colle jamais la clé secrète dans une conversation. Voir docs/SECRETS.md.

## 3. Connexion et e-mails de confirmation

*Authentication → Providers → Email* :

- **Confirm email** : activé (un compte n'est actif qu'après confirmation de l'adresse).
- **Secure email change** : activé (le changement d'adresse demande une confirmation sur les deux adresses).
- **Longueur minimale du mot de passe** : au moins 10 caractères.
- **Protection contre les mots de passe compromis** : active-la si ton plan la propose.
- **Secure password change** : facultatif. S'il est activé, le changement de mot de passe demande un code envoyé par e-mail, ce que l'application prend déjà en charge.

## 4. Envoi des e-mails par notre hook

*Authentication → Hooks → Send Email* :

1. Ajoute un hook **HTTPS** avec l'adresse : `https://<ton-site>/api/auth/email-hook`.
2. Génère le **secret** du hook. Il s'affiche une seule fois, sous la forme `v1,whsec_…`.
3. Copie-le dans Vercel, variable `SEND_EMAIL_HOOK_SECRET`, dans les environnements concernés, puis redéploie.

Une fois le hook actif, Supabase n'envoie plus lui-même les e-mails d'authentification : c'est notre hook, et Resend, qui le font.

### Notifications de sécurité

Dans la section des notifications par e-mail de Supabase, n'active que :

- **Password changed** (changement de mot de passe) ;
- **Email changed** (changement d'adresse : l'ancienne adresse est prévenue).

**Laisse désactivées** les autres notifications (téléphone, MFA, identités liées) : le hook ne les gère pas et les refuserait, ce qui bloquerait l'action concernée.

## 5. Adresses autorisées pour les liens

*Authentication → URL Configuration* (ou la section équivalente) :

- **Site URL** : l'adresse de ton site, identique à `APP_URL` dans Vercel.
- **Redirect URLs** : ajoute les pages d'authentification de ton site, par exemple `https://<ton-site>/auth/**`.

Pour les environnements Preview, ajoute les adresses exactes dont tu as besoin. Évite les jokers trop larges : ils permettraient de rediriger un lien vers un autre site.

## 6. Protection contre les robots (CAPTCHA)

> ⚠️ **N'active le CAPTCHA qu'une fois le widget branché sur les formulaires du site.** Tant que le widget n'est pas en place, l'inscription et la connexion seraient refusées.

*Authentication → section de protection contre les abus (CAPTCHA)* :

1. Crée un widget **Cloudflare Turnstile** (gratuit) dans le tableau de bord Cloudflare, pour le domaine de ton site.
2. Dans Supabase, active le CAPTCHA sur **l'inscription, la connexion et la réinitialisation du mot de passe**, avec la **clé secrète** du widget.
3. La **clé de site** du widget est publique : elle sera utilisée par le site lors de l'étape suivante du développement.

## 7. Limites de tentatives

*Authentication → Rate limits* : vérifie les valeurs proposées pour la connexion, l'inscription et l'envoi d'e-mails, et ajuste-les si nécessaire. Teste-les sur le projet de test avant la production.

Côté base de données, la limitation de débit est déjà en place : 5 questions, 30 réponses, 60 commentaires et 10 signalements par heure et par membre, plus une limite de vérifications de pseudo par adresse IP.

## 7 bis. Connexion Google [v2]

*Authentication → Providers → Google* :

1. Crée un client OAuth dans un projet Google Cloud (type « application Web »). L'adresse de rappel à déclarer côté Google est celle indiquée par Supabase dans ce même écran.
2. Copie l'identifiant et le secret du client dans Supabase. **Le secret ne va que dans Supabase**, jamais dans le code ni dans Vercel.
3. Ajoute `https://<ton-site>/auth/callback` dans les URL de redirection autorisées (déjà couvertes par `https://<ton-site>/auth/**`).

Après une connexion Google, le profil reste **en attente** jusqu'à la complétion (pseudo, date de naissance, CGU) et la vérification du téléphone.

## 7 ter. Téléphone (SMS) [v2]

Le compte ne s'active qu'avec un téléphone vérifié. La vérification passe par un code SMS envoyé par Supabase, qui le délègue à notre hook SMS.

1. *Authentication → Providers → Phone* : active la connexion par téléphone.
2. **Ne configure pas de fournisseur SMS dans Supabase.** L'envoi passe par notre hook, qui utilise Twilio : les identifiants Twilio restent dans Vercel.
3. *Authentication → Hooks → Send SMS* : ajoute un hook HTTPS vers `https://<ton-site>/api/auth/sms-hook`, génère le secret, puis copie-le dans Vercel (`SEND_SMS_HOOK_SECRET`) et redéploie.
4. Dans Vercel, renseigne `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et, de préférence, `TWILIO_MESSAGING_SERVICE_SID`.

**Points à connaître avant le test** :
- Un nom d'expéditeur alphanumérique est limité à **11 caractères** : `YouthConnect` (12 caractères) est trop long. Utilise un service de messagerie, ou un nom comme `YOUTHCONN`, à faire enregistrer si le pays l'exige.
- Un compte d'essai Twilio ne peut souvent écrire qu'à des numéros vérifiés dans la console Twilio : vérifie ce point avant de tester avec un numéro +228.
- Le hook limite à 3 SMS par numéro et par heure, et à 500 SMS par jour au total (`SMS_DAILY_LIMIT`).

## 8. Vérifications

Une fois tout configuré :

1. Lance le contrôle automatique, avec la clé publiable uniquement :
   ```bash
   SUPABASE_URL="https://<projet>.supabase.co" SUPABASE_PUBLISHABLE_KEY="sb_publishable_…" npm run check:supabase
   ```
   Il vérifie notamment que la confirmation par e-mail est obligatoire, que les compteurs et les numéros sont protégés, et que les migrations sont appliquées. Un ✘ indique ce qu'il faut corriger.
2. `https://<ton-site>/api/config` renvoie l'adresse du projet et la clé publiable, rien d'autre.
3. Une inscription de test envoie un e-mail de confirmation à l'adresse de ton compte Resend (en mode test). La recette complète est dans `docs/AUTH.md`.
4. Le lien du mail ouvre la page `/auth/confirm`, qui confirme l'adresse.
5. Dans les journaux Vercel de `/api/auth/email-hook`, le message « confirmé(s) par le fournisseur » apparaît, sans aucune adresse.
