# Clés et secrets : ce qui va où

## Le principe

Il y a deux familles de valeurs :

- **Publiques** : peuvent être vues par n'importe quelle personne qui ouvre le site. Elles sont conçues pour cela.
- **Privées** : donnent un pouvoir. Elles ne doivent exister que sur le serveur (Vercel), jamais dans le navigateur, le code ou GitHub.

La protection des données repose sur la **sécurité par ligne (RLS)** de la base. La clé publiable est soumise à RLS. La clé secrète ne l'est pas : c'est pourquoi elle doit rester sur le serveur.

## Tableau de référence

| Variable | Visibilité | Où la mettre | Format attendu | Utilisée par |
|---|---|---|---|---|
| `SUPABASE_URL` | Publique | Vercel (tous les environnements) | `https://<projet>.supabase.co` | `/api/config`, fonctions serveur |
| `SUPABASE_PUBLISHABLE_KEY` | Publique | Vercel | `sb_publishable_…` | `/api/config` (envoyée au navigateur) |
| `SUPABASE_SECRET_KEY` | **Privée** | Vercel uniquement | `sb_secret_…` | `/api/username-available` |
| `SEND_EMAIL_HOOK_SECRET` | **Privée** | Vercel **et** Supabase (même valeur) | `v1,whsec_…` | `/api/auth/email-hook` |
| `RESEND_API_KEY` | **Privée** | Vercel uniquement | `re_…` | `/api/auth/email-hook` |
| `IP_HASH_SECRET` | **Privée** | Vercel uniquement | 32 caractères ou plus, aléatoires | Limitation de débit |
| `EMAIL_FROM` | Publique | Vercel | `Nom <adresse@domaine>` | Hook e-mail |
| `APP_URL` | Publique | Vercel | `https://<site>` | Liens des e-mails |
| `SEND_SMS_HOOK_SECRET` | **Privée** | Vercel **et** Supabase (même valeur) | `v1,whsec_…` | `/api/auth/sms-hook` |
| `TWILIO_ACCOUNT_SID` | **Privée** | Vercel uniquement | `AC…` | `/api/auth/sms-hook` |
| `TWILIO_AUTH_TOKEN` | **Privée** | Vercel uniquement | 32 caractères hexadécimaux | `/api/auth/sms-hook` |
| `TWILIO_MESSAGING_SERVICE_SID` | Privée | Vercel uniquement | `MG…` (recommandé) | `/api/auth/sms-hook` |
| `TWILIO_FROM` | Privée | Vercel uniquement | Numéro E.164, ou nom de 11 caractères maximum | `/api/auth/sms-hook` (si pas de service) |
| `SMS_DAILY_LIMIT` | Privée | Vercel | Entier positif (500 par défaut) | `/api/auth/sms-hook` |

Les environnements Vercel (**Production**, **Preview**, **Development**) doivent pointer vers des projets distincts :

- **Production** → projet Supabase de production, domaine réel, clé Resend de production ;
- **Preview / Development** → projet Supabase de **test**, domaine de test, clés de test.

## Ce qui est interdit

- Une clé secrète, un secret de hook ou une clé Resend dans un fichier du site (`index.html`, `script.js`, `style.css`, `sw.js`, `manifest.json`).
- Une clé `service_role` dans le navigateur. Les anciennes clés JWT `anon` et `service_role` sont en cours de retrait : utilise les clés `sb_publishable_` et `sb_secret_`.
- Un fichier `.env` contenant de vraies valeurs dans le dépôt GitHub. Le `.gitignore` l'empêche, et un test automatique le vérifie.
- **Coller une clé dans une conversation, un ticket, une capture d'écran ou un message.** Si cela arrive, fais une rotation immédiate (voir plus bas).

Des tests automatiques protègent ces règles : `tests/security/no-secrets.test.js` échoue si un matériel secret se trouve dans un fichier servi au navigateur, et `tests/unit/public-routes.test.js` vérifie que `/api/config` ne renvoie jamais une clé secrète, même mal placée dans la variable publique.

## Vérifier la configuration

- `https://<ton-site>/api/config` doit renvoyer uniquement `supabaseUrl`, `supabasePublishableKey` et `environment`. Si la fonction répond « configuration incomplète », une variable est absente ou mal placée : le message de journal indique laquelle, sans afficher sa valeur.

## Procédure de rotation

### En cas de fuite suspectée de la clé secrète Supabase

1. Supabase → Settings → API Keys → crée une **nouvelle** clé secrète.
2. Vercel → remplace `SUPABASE_SECRET_KEY` (Production et Preview), puis redéploie.
3. Vérifie que les fonctions fonctionnent avec la nouvelle clé.
4. Supabase → supprime l'ancienne clé secrète.

### En cas de fuite du secret du hook

1. Supabase → Authentication → Hooks → régénère le secret du hook d'e-mail.
2. Vercel → remplace `SEND_EMAIL_HOOK_SECRET`, puis redéploie.
3. Teste une inscription de test.

### En cas de fuite de la clé Resend

1. Resend → API Keys → crée une nouvelle clé, puis supprime l'ancienne.
2. Vercel → remplace `RESEND_API_KEY`, puis redéploie.

Une clé publiable qui fuite ne compromet pas la base : la RLS limite ce qu'elle permet. Elle se remplace tout de même dans les mêmes conditions que les autres.

## Pourquoi `IP_HASH_SECRET` existe

Les compteurs anti-spam identifient les visiteurs par leur adresse IP. Pour ne jamais stocker une adresse en clair, on la transforme avec une clé secrète (HMAC). Sans cette clé, il est impossible de retrouver l'adresse à partir du compteur.
