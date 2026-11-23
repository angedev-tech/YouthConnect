# Prêt à lancer : état et tâches

Référence : `docs/CAHIER-DES-CHARGES.md` (v2, 19 novembre 2026).

**Légende** — ✅ fait et testé · 🟡 fait en code, pas encore vérifié en conditions réelles · ⬜ à faire
**Responsable** — 🤖 moi · 👤 toi · 🤝 ensemble

---

## 1. Décisions (cahier v2)

- ✅ D1 Âge minimum 18 ans : contrôlé par la base (inscription et complétion du profil)
- 🟡 D2 Connexion Google : code et base faits ; configuration Google Cloud et Supabase à faire — 👤
- 🟡 D3 Téléphone obligatoire et vérifié : base et fonctions du navigateur faites ; fournisseur SMS à choisir et à tester (+228) — 👤 (P1)
- 🟡 D4 Notifications push : base et préférences faites ; envoi serveur et interface à faire — 🤖
- ✅ D5 Formulaire de contact : information sur Formspree et consentement obligatoire
- ⬜ D6 Migration : outil à écrire, avec verrou de sauvegarde (cahier, section 12) — 🤖 ; sauvegarde complète — 👤
- ⬜ D7 Anciens auteurs « ancien membre » : base faite ; migration à faire — 🤝

## 2. Validation des points P1 à P5 (cahier, section 3)

- ✅ P1 validé : fournisseur SMS Twilio. Test réel vers un numéro +228 à faire — 👤
- ✅ P2 validé : deuxième facteur obligatoire pour modérateurs et administrateurs — implémentation à faire 🤖
- ✅ P3 validé : suppression des comptes inachevés après 30 jours — implémentation à faire 🤖
- ✅ P4 validé : journal de sécurité conservé 12 mois — implémentation à faire 🤖
- ✅ P5 Réinitialisation par SMS reportée

## 3. Socle technique

- ✅ Base : schéma, RLS, droits, règles métier, activation, limites, connexion par pseudo (migrations 1 à 8 ; 89 tests de base)
- ✅ Connexion par pseudo sans révéler l'adresse (`/api/sign-in`)
- ✅ Vérification de pseudo limitée par adresse IP (`/api/username-available`)
- ✅ Service worker : cache limité aux fichiers statiques
- 🟡 Hook e-mail Supabase vers Resend : à vérifier sur Vercel et Supabase
- 🟡 Hook SMS Supabase vers Twilio : code, limites, dédoublonnage et tests faits ; à vérifier sur Vercel et Supabase — 🤝
- ✅ Contrôle de configuration : `npm run check:supabase`

## 4. Authentification sur le site

- 🟡 Pages `/auth/confirm`, `/auth/reset-password`, `/auth/callback` : pas encore vues dans un navigateur
- 🟡 Fonctions : inscription, connexion, Google, vérification du téléphone, complétion du profil, réglages (testées sur la logique)
- ⬜ Accueil : modales d'inscription et de connexion branchées sur Supabase, en remplacement de l'ancien système — 🤖
- ⬜ Page de complétion du profil (pseudo, date de naissance, CGU, téléphone et code) — 🤖
- ⬜ Page de vérification du téléphone (saisie du numéro, code à 6 chiffres) — 🤖
- ⬜ Paramètres : mot de passe, adresse, téléphone, préférences, suppression du compte — 🤖
- ⬜ Widget Turnstile sur inscription, connexion et réinitialisation — 🤖 (clé de site : 👤)
- ⬜ Activer le CAPTCHA côté Supabase **après** le widget — 👤

## 5. Forum, notifications, administration

- ⬜ Remplacer Firestore (35 lignes de l'ancien code) par Supabase : questions, réponses, commentaires — 🤖
- ⬜ Réactions, recherche, filtres, pagination — 🤖
- ⬜ Profils publics et modification du profil — 🤖
- ⬜ Notifications dans l'application — 🤖
- ⬜ Abonnements push : envoi serveur (web-push, clés VAPID), abonnement côté navigateur, préférences — 🤖 (clés : 👤)
- ⬜ Signalements côté membre, historique d'activité — 🤖
- ⬜ File de modération, suspension (avec blocage dans l'authentification), catégories, rôles, statistiques réelles, journal — 🤖

## 6. Sécurité du site

- ⬜ Échapper tout contenu utilisateur ; corriger l'injection par `imageUrl` (faille de l'ancien code) — 🤖
- ⬜ Upload d'images signé par le serveur (préréglage Cloudinary public aujourd'hui) — 🤖
- ⬜ En-têtes de sécurité et politique de contenu (CSP) — 🤖
- ⬜ Supprimer l'ancien système de comptes (mots de passe en clair dans le navigateur) — 🤖
- ⬜ Règles Firestore de l'ancien site : vérifier aujourd'hui qu'elles n'acceptent pas les écritures libres — 👤

## 7. Contenu et données fictives

- ⬜ Retirer le « +100 » sur le nombre de membres — 🤖
- ⬜ Retirer les faux avis de l'accueil — 🤖
- ⬜ Retirer les données de démonstration (`DEMO_POSTS`) — 🤖
- ⬜ Corriger le lien e-mail cassé (`https://mailto:…`) — 🤖

## 8. Comptes et services

- ⬜ Projet Supabase de test : migrations 1 à 8, Auth, Google, téléphone, hooks — 👤
- ⬜ Projet Supabase de production, plan payant : pas de mise en pause, sauvegardes — 👤
- ⬜ Vercel : variables Preview puis Production — 👤
- ⬜ Resend : clé de test, puis clé de production et domaine vérifié (SPF, DKIM, DMARC) — 👤
- ⬜ Cloudflare Turnstile : clé de site et clé secrète (dans Supabase) — 👤
- ⬜ Google Cloud : client OAuth pour la connexion Google — 👤
- ⬜ Compte Twilio ouvert, expéditeur choisi (service de messagerie ou nom de 11 caractères) — 👤
- ⬜ Clés VAPID pour les notifications push (générées par la commande du projet, à mettre dans Vercel) — 👤
- ⬜ Nom de domaine professionnel — 👤

## 9. Juridique

- ⬜ Conditions d'utilisation (dont 18 ans) — 👤, avec relecture par un juriste
- ⬜ Politique de confidentialité : téléphones, e-mails, dates de naissance, sous-traitants, durées — 👤, avec relecture
- ⬜ Mentions légales — 👤
- ⬜ Information sur le traitement de Formspree : à compléter par la politique de confidentialité — 👤

## 10. Tests et recette

- ✅ Tests automatiques : 181 unitaires et de sécurité, 94 de base de données
- ⬜ Les 16 tests du cahier initial sur le projet de test, avec de vrais e-mails et de vrais SMS — 🤝
- ⬜ Test Google de bout en bout — 🤝
- ⬜ Vérifier sur Vercel que le hook lit le corps brut et répond dans le délai imposé par Supabase — 🤝
- ⬜ Test sur téléphone : installation, notifications (Android, iPhone avec application installée) — 👤
- ⬜ Accessibilité (WCAG 2.1 AA) — 🤖 (vérification) et 👤

## 11. Migration (D6, D7)

- ⬜ Sauvegarde complète de l'ancienne base, avec manifeste et sommes de contrôle — 👤
- ⬜ Outil de migration avec verrou (refus sans sauvegarde vérifiée), simulation et rapport — 🤖
- ⬜ Accord écrit après lecture du rapport — 👤
- ⬜ Contrôle après migration — 🤝

## 12. Mise en ligne

- ⬜ Déploiement Preview, recette, corrections — 🤝
- ⬜ Déploiement Production : domaine, variables, plan payant — 👤
- ⬜ Mettre à jour `APP_URL` et les URL autorisées dans Supabase — 👤
- ⬜ Retirer l'ancien site et ses règles Firestore ouvertes — 👤

---

## Ordre recommandé

1. **Toi, maintenant** : vérifier les règles Firestore de l'ancien site ; appliquer les migrations 1 à 8 sur le projet de test ; configurer Auth, Google et le téléphone ; renseigner les variables Vercel Preview ; lancer `npm run check:supabase`.
2. **Toi, en parallèle** : valider P1 à P5 ; choisir et tester le fournisseur SMS (+228).
3. **Moi** : hook SMS, envoi des notifications push, pages du site (accueil, complétion du profil, vérification du téléphone, paramètres), puis forum et administration.
4. **Moi** : outil de migration avec verrou de sauvegarde ; sécurité du rendu ; CAPTCHA ; CSP ; suppression du compte.
5. **Ensemble** : recette des tests, corrections, puis mise en ligne.
