# E-mails : aujourd'hui (test) et le jour où tu auras ton domaine

## Comment fonctionne l'envoi

1. Un membre s'inscrit, demande un nouveau mot de passe ou change son adresse.
2. **Supabase** n'envoie pas l'e-mail lui-même : il appelle notre hook `/api/auth/email-hook`.
3. Le hook **vérifie la signature** de l'appel (sans signature valide, rien n'est envoyé).
4. Il construit le message aux couleurs de YouthConnect et l'envoie via **Resend**.
5. Il répond « succès » à Supabase **seulement si Resend a confirmé** l'envoi. Sinon, le membre voit un message d'erreur clair.

Ce qui change selon ton environnement : trois variables Vercel. **Aucune modification du code n'est nécessaire** pour passer du test à la production.

| Variable | Rôle | Exemple (test) | Exemple (production) |
|---|---|---|---|
| `EMAIL_FROM` | Expéditeur | `YouthConnect <onboarding@resend.dev>` | `YouthConnect <no-reply@mail.ton-domaine.fr>` |
| `APP_URL` | Adresse du site (liens des e-mails) | `https://ton-test.vercel.app` | `https://ton-domaine.fr` |
| `RESEND_API_KEY` | Clé Resend (serveur) | `re_…` | `re_…` (clé dédiée à la production) |

## Aujourd'hui : tester sans domaine

- `onboarding@resend.dev` est le domaine de test de Resend. **Il ne livre qu'à l'adresse e-mail de ton compte Resend.** Un autre destinataire reçoit une erreur 403.
- Pour tester une inscription, utilise donc **l'adresse e-mail de ton compte Resend**. Ce n'est pas un bug, c'est la protection de réputation de Resend.
- Le code **refuse de démarrer en production** si `EMAIL_FROM` pointe vers `resend.dev` (test automatisé dans `tests/unit/env.test.js`).

## Sous-domaine gratuit : vérifie avant de t'y engager

Pour envoyer depuis ton propre sous-domaine (par exemple `mail.ton-nom.example.org`), Resend doit **vérifier** ce domaine en lisant des enregistrements DNS que tu ajoutes. Le service gratuit doit donc te permettre de créer :

- des enregistrements **TXT** (SPF, DKIM, DMARC) ;
- un enregistrement **MX** (gestion des rebonds) ;
- parfois un **CNAME**, selon ce que Resend t'affiche.

Si le service gratuit ne propose pas ces types d'enregistrements, Resend ne pourra pas vérifier le domaine. **Vérifie cela avant de commencer.**

Précaution : un sous-domaine gratuit a souvent mauvaise réputation auprès des boîtes mail. Garde-le pour les tests. Avant d'écrire à de vrais membres, achète un domaine.

## Le jour où tu achètes ton domaine

1. **Resend → Domains → Add Domain.** Indique le sous-domaine d'envoi, par exemple `mail.ton-domaine.fr`.
2. Ouvre l'onglet **Records**. Copie **exactement** chaque enregistrement affiché (type, nom, valeur). Ne te fie pas à des valeurs notées ailleurs : selon ton domaine, Resend peut afficher des TXT, des MX ou des CNAME.
3. Ajoute ces enregistrements chez le fournisseur DNS de ton domaine (là où tu l'as acheté). Certains fournisseurs ajoutent automatiquement ton nom de domaine à la fin des valeurs MX : vérifie que ce n'est pas le cas.
4. **DMARC.** Ajoute un enregistrement TXT sur `_dmarc.ton-domaine.fr` : `v=DMARC1; p=none; rua=mailto:ton-adresse@exemple.fr`. Commence toujours en `p=none` (mode surveillance).
5. **Resend → Verify DNS Records.** La vérification prend quelques minutes, parfois jusqu'à 72 heures.
6. **Contrôle depuis ton ordinateur :**
   ```bash
   npm run dns:check -- mail.ton-domaine.fr
   ```
   L'outil indique ce qui est présent ou manquant. Il n'envoie et ne modifie rien.
7. **Vercel → Environment Variables → Production.** Mets à jour `EMAIL_FROM` (par exemple `YouthConnect <no-reply@mail.ton-domaine.fr>`), puis **redéploie** : une variable ne s'applique qu'après un nouveau déploiement.
8. **Si l'adresse du site change**, mets à jour `APP_URL`, puis dans Supabase (réglages des URL d'authentification) : *Site URL* et *Redirect URLs*. Voir docs/CONFIGURATION-SUPABASE.md.
9. **Teste** avec une adresse réelle, différente de ton compte Resend : inscription, puis réinitialisation de mot de passe. Vérifie aussi les spams.
10. **Renforce DMARC** après quelques semaines sans problème : `p=quarantine`, puis `p=reject`. Passe à l'étape suivante seulement après avoir lu les rapports reçus à l'adresse `rua`.

## Ce qui ne change pas

Le code, les modèles d'e-mails, le hook et la configuration Supabase restent identiques. Seules les trois variables ci-dessus changent, et les enregistrements DNS sont ajoutés chez ton fournisseur de domaine.

## Dépannage

| Symptôme | Cause probable | Action |
|---|---|---|
| Erreur 403 « You can only send testing emails to your own email address » | Expéditeur `resend.dev` et destinataire différent de ton compte | Teste avec l'adresse de ton compte Resend, ou vérifie ton domaine |
| Erreur de domaine (expéditeur différent du domaine vérifié) | `EMAIL_FROM` n'utilise pas exactement le domaine vérifié | Corrige `EMAIL_FROM` avec le domaine exact |
| L'inscription affiche « l'e-mail n'a pas pu être envoyé » | Resend a refusé ou n'a pas répondu | Consulte les journaux de la fonction `/api/auth/email-hook` dans Vercel : ils indiquent la cause, sans adresse ni contenu |
| Les e-mails arrivent dans les spams | SPF, DKIM ou DMARC pas encore en place ou pas encore propagés | Lance `npm run dns:check`, attends la propagation, puis reteste |
| Le lien de l'e-mail mène à une page d'erreur | `APP_URL` ou les *Redirect URLs* Supabase ne correspondent pas au site | Aligne `APP_URL` et les URL autorisées dans Supabase |
