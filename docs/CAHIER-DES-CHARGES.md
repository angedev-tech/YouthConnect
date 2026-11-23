# Cahier des charges — YouthConnect

**Version** : 2.0 · **Date** : 19 novembre 2026 · **Statut** : décisions D1 à D7 et points P1 à P6 validés par le porteur du projet le 19 novembre 2026.

**Historique**
- **v1** : cahier initial (authentification complète, base relationnelle, rôles, forum, sécurité, déploiement, tests).
- **v2** : intègre les décisions du 19 novembre 2026 (âge minimum, connexion Google, téléphone obligatoire, notifications push, Formspree, migration, anciens auteurs). Les exigences qui en découlent sont marquées **[v2]**.

---

## 1. Objet et public

YouthConnect est une plateforme d'entraide entre jeunes adultes : partager, apprendre et grandir ensemble, sur des sujets comme les études, l'informatique, l'entrepreneuriat, l'emploi ou les bourses. Le public est **réservé aux personnes âgées de 18 ans ou plus** [v2].

Le site doit être sûr pour ses membres, transparent sur le traitement de leurs données, et tenable techniquement à long terme.

## 2. Décisions retenues [v2]

| # | Décision | Mise en œuvre | Statut |
|---|---|---|---|
| D1 | Âge minimum : 18 ans | Contrôlé par la base, à l'inscription et à la complétion du profil. Un mineur n'est jamais enregistré. | Base faite, interface à faire |
| D2 | Connexion Google dès la première version | Fournisseur Google dans Supabase, retour sur `/auth/callback`, profil à compléter (pseudo, date de naissance, CGU, téléphone) | Code et base faits ; configuration Google à faire |
| D3 | Téléphone obligatoire dès l'inscription, vérifié par SMS | Compte **actif seulement si** e-mail confirmé **et** téléphone vérifié | Base faite ; SMS à configurer (fournisseur à choisir) |
| D4 | Notifications push activées, conservées et améliorées | Abonnements protégés, préférences par type, alertes de sécurité non désactivables | Base faite ; envoi et interface à faire |
| D5 | Formspree conservé provisoirement, avec information transparente | Information sur le traitement par un tiers, consentement obligatoire avant envoi | **Fait** (`index.html`) |
| D6 | Migration des anciennes publications après sauvegarde complète | Sauvegarde vérifiée obligatoire avant toute migration (voir section 12) | À faire |
| D7 | Anciens auteurs sans compte identifiés comme « ancien membre » | Aucun nom ancien n'est migré ; contenu sans lien avec un compte, marqué `is_legacy` | Base faite ; migration à faire |

## 3. Points validés

Validés le 19 novembre 2026, tels que proposés ci-dessous.

| # | Question | Proposition |
|---|---|---|
| P1 | Fournisseur SMS | Twilio (référence le Togo ; envoi sans réponses entrantes), après un test réel vers un numéro +228. Certains fournisseurs excluent le Togo : le test est indispensable. |
| P2 | Deuxième facteur (connexion sécurisée) | Facultatif pour les membres ; **obligatoire** pour les modérateurs et les administrateurs. |
| P3 | Comptes inachevés (e-mail ou téléphone non vérifié) | Suppression automatique après 30 jours, après information. |
| P4 | Durée de conservation du journal de sécurité | 12 mois. |
| P5 | Réinitialisation du mot de passe par SMS | Reportée après la première version ; la réinitialisation par e-mail suffit. |
| P6 | Anciennes publications pouvant contenir des données personnelles (numéros, adresses, propos sur des mineurs) | Contrôle automatique avant migration (numéros de téléphone, adresses e-mail, mots-clés sensibles), revue humaine des contenus signalés, suppression ou anonymisation avant migration. Aucun nom recopié (D7). |

## 4. Périmètre

**Inclus (première version)** : inscription par e-mail ou Google, vérification e-mail et téléphone, connexion, réinitialisation, réglages du compte, forum (questions, réponses, commentaires, réactions, recherche, filtres, pagination), profils, notifications in-app et push, signalements, administration, contact, migration des anciennes publications, application installable (PWA).

**Exclu** : messagerie privée, paiements, application native, publicité, réinitialisation par SMS (P5), connexion par d'autres fournisseurs que Google.

## 5. Acteurs et états

| État | Description | Ce qu'il peut faire |
|---|---|---|
| Visiteur | Non connecté | Lire les contenus publics, s'inscrire, se connecter, contacter l'équipe |
| Membre en attente | Compte créé, e-mail ou téléphone non vérifié, ou profil incomplet | Terminer ses vérifications, modifier ses informations, se déconnecter |
| Membre actif | E-mail et téléphone vérifiés, 18 ans ou plus, CGU acceptées, pseudo choisi | Publier, répondre, réagir, signaler, recevoir des notifications |
| Membre suspendu | Suspendu par l'équipe | Rien ; ses contenus ne sont plus visibles du public |
| Ancien membre | Auteur d'une ancienne publication, sans compte | Rien : son contenu apparaît sous « ancien membre » |
| Modérateur | Rôle attribué par un administrateur | Masquer et restaurer des contenus, traiter les signalements |
| Administrateur | Rôle attribué par un administrateur | Tout le reste : utilisateurs, catégories, rôles, statistiques, journal |

Un compte ne devient **actif** que par la base, à partir des preuves tenues par l'authentification (e-mail confirmé, téléphone vérifié). Un client ne peut pas se déclarer actif. Une réactivation par un administrateur ne contourne pas ces vérifications.

## 6. Exigences fonctionnelles

### Inscription et vérifications

- **FR-01 Inscription par e-mail** : pseudo, prénom, nom, date de naissance, adresse e-mail, téléphone (indicatif et numéro), mot de passe (10 caractères minimum), confirmation du mot de passe, acceptation des CGU. Tout est revalidé par la base. **[v2]** date de naissance et téléphone obligatoires.
- **FR-02 Confirmation de l'adresse** : lien unique envoyé par e-mail. Renvoi possible, limité en fréquence.
- **FR-03 Vérification du téléphone** : code à 6 chiffres envoyé par SMS, expiration du code, nombre limité de tentatives, possibilité de corriger le numéro tant que le code n'est pas validé. Un numéro vérifié ne peut appartenir qu'à un seul compte. **[v2]**
- **FR-04 Activation** : le compte devient actif seulement si l'e-mail est confirmé, le téléphone vérifié, l'âge atteint, les CGU acceptées et le pseudo choisi. **[v2]**
- **FR-05 Connexion par e-mail ou pseudo** : le pseudo est résolu côté serveur, l'adresse e-mail n'est jamais renvoyée au navigateur. Messages génériques (« identifiants incorrects ») quel que soit le cas.
- **FR-06 Connexion Google** : après le premier retour de Google, le profil est complété (pseudo, date de naissance, CGU, nom si absent, téléphone puis code SMS). Un mineur ne peut pas compléter son profil, et sa date n'est jamais enregistrée. **[v2]**
- **FR-07 Déconnexion** : de l'appareil courant. Après une réinitialisation de mot de passe, toutes les sessions sont fermées. Après un changement de mot de passe, les autres sessions sont fermées.
- **FR-08 Mot de passe oublié** : réponse identique que le compte existe ou non. Lien unique, expiration, nouveau mot de passe enregistré, ancien mot de passe sans effet.

### Réglages du compte

- **FR-09 Réglages** : changement de mot de passe (ancien mot de passe vérifié, ou code par e-mail si la confirmation renforcée est activée), changement d'adresse (confirmation sur les deux adresses, alerte sur l'ancienne), changement de téléphone (nouvelle vérification obligatoire), préférences de notification.
- **FR-10 Suppression du compte** : à faire. Les publications restent, sans auteur identifiable (« ancien membre »).

### Forum et communauté

- **FR-11 Contenus** : publier, modifier et supprimer ses propres questions, réponses et commentaires. Un contenu masqué par l'équipe ne peut plus être modifié par son auteur.
- **FR-12 Interactions** : réponses, commentaires, réactions (« j'aime », « utile », « merci »). On ne réagit pas à son propre contenu, une seule fois par type.
- **FR-13 Découverte** : recherche plein texte en français, filtres par catégorie, pagination.
- **FR-14 Profils** : profil public (pseudo, avatar, bio, localisation générale). Le nom, le téléphone et la date de naissance ne sont jamais publics.
- **FR-15 Historique** : le membre voit ses publications, réponses et réactions.

### Notifications [v2]

- **FR-16 Notifications dans l'application** : réponse à une question, commentaire sur une réponse, réaction, traitement d'un signalement, alertes de sécurité. Liste, marquage lu ou non lu.
- **FR-17 Notifications push** : abonnement après une action du membre (et non dès l'arrivée sur le site), protégé par l'authentification. Un appareil ne compte qu'une fois ; dix appareils maximum par compte. Désabonnement à la déconnexion. Sur iPhone, les notifications ne fonctionnent que si l'application est installée sur l'écran d'accueil.
- **FR-18 Préférences** : par type (réponses, commentaires, réactions, modération). **Les alertes de sécurité ne peuvent pas être désactivées.**
- **FR-19 Liens** : toujours internes (aucune adresse externe dans une notification).

### Signalements et modération

- **FR-20 Signalement** : par un membre actif, sur une question, une réponse, un commentaire ou un profil. Un même contenu ne se signale qu'une fois. Un contenu propre ne se signale pas. Limite de 10 par heure.
- **FR-21 Traitement** : les modérateurs masquent ou rejettent un signalement. Le masquage est réversible. Le signalant est informé du traitement, sans détail sur la décision.

### Administration

- **FR-22 Utilisateurs** : liste, suspension et réactivation. Une suspension bloque aussi la connexion dans le service d'authentification (route serveur à écrire).
- **FR-23 Rôles** : attribution des rôles modérateur et administrateur par un administrateur. Il reste toujours au moins un administrateur.
- **FR-24 Catégories** : création, modification, désactivation.
- **FR-25 Statistiques réelles** : membres actifs, questions, réponses, signalements. Aucun chiffre fictif.
- **FR-26 Journal de sécurité** : consultable par les administrateurs.

### Contact [v2]

- **FR-27 Formulaire de contact** : provisoirement traité par Formspree. Avant envoi, le membre lit l'information sur le traitement par ce service tiers et coche une case de consentement. Le formulaire sera remplacé ensuite, et la politique de confidentialité sera publiée.

### Migration [v2]

- **FR-28 Anciennes publications** : migrées **uniquement après une sauvegarde complète et vérifiée** (section 12). Les auteurs sans compte sont affichés « ancien membre ». Aucun nom de l'ancienne version n'est recopié.

### Application

- **FR-29 PWA** : installable, icônes, mode hors ligne limité aux fichiers statiques du site. Aucune donnée personnelle n'est mise en cache.

## 7. Exigences non fonctionnelles

### Sécurité

- **NFS-01** Aucun secret dans le navigateur, le code ou GitHub. La clé secrète, la clé Resend, le secret du hook et les clés push restent sur le serveur. Test automatique.
- **NFS-02** Accès aux données par règles de sécurité (RLS) et droits colonne par colonne. Un client ne peut ni se déclarer actif, ni lire un téléphone, ni modifier une date de naissance, ni créer une notification.
- **NFS-03** Limitation des tentatives : par adresse IP et par identifiant, sur les routes publiques et la connexion. CAPTCHA sur l'inscription, la connexion et la réinitialisation.
- **NFS-04** Les appels entrants (hook d'e-mail, futur hook SMS) sont signés et horodatés.
- **NFS-05** Tout contenu utilisateur est échappé à l'affichage. Une image ne peut venir que de nos comptes d'hébergement.
- **NFS-06** En-têtes de sécurité (anti-intégration, pas de déduction de type, politique de référent) et politique de contenu adaptée au site (à compléter).
- **NFS-07** Les journaux ne contiennent ni adresse e-mail, ni mot de passe, ni jeton, ni clé, ni pseudo.

### Confidentialité

- **NFS-08** Minimisation : la date de naissance, le téléphone et les noms sont privés. Un mineur n'est jamais enregistré.
- **NFS-09** Durées de conservation : voir P3 et P4 ; les notifications sont conservées 6 mois (proposition).
- **NFS-10** Droit à l'effacement : suppression du compte (FR-10).
- **NFS-11** Information des membres : politique de confidentialité, mentions légales, CGU (section 9 et livrables juridiques).

### Qualité et accessibilité

- **NFS-12** Accessibilité : objectif WCAG 2.1 niveau AA (contrastes, navigation au clavier, libellés, messages d'erreur liés aux champs).
- **NFS-13** Compatibilité : navigateurs récents, Android et iOS.
- **NFS-14** Performance : pagination, index sur les colonnes filtrées, compteurs agrégés.
- **NFS-15** Maintenabilité : migrations versionnées, tests automatiques, documentation à jour, dépendances épinglées.

### Disponibilité et exploitation

- **NFS-16** Sauvegardes automatiques, restauration testée avant la mise en production.
- **NFS-17** Projet de production sur le plan payant du fournisseur de base de données (pas de mise en pause).
- **NFS-18** Surveillance : journaux consultables, une alerte simple sur les erreurs du hook.

## 8. Données personnelles

| Donnée | Finalité | Visibilité | Durée proposée |
|---|---|---|---|
| Pseudo | Identifier le membre | Public | Tant que le compte existe |
| Prénom, nom | Identification interne, modération | Privée | Tant que le compte existe |
| Date de naissance | Contrôle de l'âge (18 ans) | Privée | Tant que le compte existe |
| Adresse e-mail | Connexion, confirmations, notifications de sécurité | Privée | Tant que le compte existe |
| Téléphone | Vérification, connexion sécurisée | Privé | Tant que le compte existe |
| Avatar, bio, localisation générale | Profil | Public, facultatif | Tant que le compte existe |
| Contenus (questions, réponses, commentaires) | Fonctionnement du forum | Public | Tant qu'ils ne sont pas supprimés |
| Réactions, signalements | Fonctionnement, modération | Privée (sauf compteurs) | Tant que le compte existe |
| Notifications | Information du membre | Privée | 6 mois (proposition) |
| Abonnements push | Envoi des notifications | Privée, adresse secrète non lisible | Tant que l'appareil est abonné |
| Journal de sécurité | Sécurité, traçabilité | Administrateurs | 12 mois (P4) |
| Messages de contact | Répondre à une demande | Équipe | Selon la politique de Formspree, jusqu'au remplacement du formulaire |

Aucun mineur n'est enregistré. Aucune donnée n'est vendue ni utilisée pour de la publicité.

## 9. Sous-traitants et services

| Service | Rôle | Données concernées | Statut |
|---|---|---|---|
| Supabase | Base de données, authentification | Toutes les données du compte | Configuré (test) ; production à faire (plan payant) |
| Vercel | Hébergement, fonctions | Requêtes, journaux | Configuré (test) ; production à faire |
| Resend | Envoi des e-mails | Adresse, contenu des messages d'authentification | Test ; domaine à vérifier |
| Fournisseur SMS (Twilio proposé) | Codes de vérification | Numéro, code | À choisir (P1) et à tester (+228) |
| Google | Connexion | Identité Google, adresse e-mail | À configurer (projet Google Cloud) |
| Formspree | Formulaire de contact | Nom, e-mail, sujet, message | Provisoire (D5) |
| Cloudinary | Images | Images envoyées par les membres | Signature des envois à faire |
| Services de notification des navigateurs | Notifications push | Adresse secrète de l'appareil | Clés à générer ; envoi à faire |

Chaque sous-traitant doit être mentionné dans la politique de confidentialité.

## 10. Architecture

Voir `docs/ARCHITECTURE.md`. Principe : le navigateur ne décide de rien ; la base fait foi ; les fonctions serveur détiennent les secrets.

## 11. Critères d'acceptation

### Tests obligatoires du cahier initial

1. Inscription avec une nouvelle adresse e-mail.
2. Refus d'une adresse e-mail déjà utilisée.
3. Confirmation de l'adresse e-mail.
4. Connexion avec les bons identifiants.
5. Refus d'un mauvais mot de passe.
6. Déconnexion.
7. Accès interdit aux pages privées après déconnexion.
8. Demande de réinitialisation du mot de passe.
9. Réception et utilisation du lien de réinitialisation.
10. Réinitialisation par SMS (reportée, P5).
11. Modification du profil.
12. Publication d'une question.
13. Ajout d'une réponse.
14. Gestion des notifications.
15. Permissions administrateur et membre.
16. Règles RLS.

### Tests ajoutés par la v2 [v2]

- **A1** Un mineur ne peut pas s'inscrire ; la veille des 18 ans est refusée, le jour des 18 ans est accepté.
- **A2** Un compte avec e-mail confirmé seul, ou téléphone vérifié seul, reste en attente.
- **A3** Un compte en attente ne peut rien publier.
- **A4** Changer de numéro sans le vérifier fait repasser le compte en attente.
- **A5** Une connexion Google crée un profil en attente, sans date de naissance ni téléphone inventés.
- **A6** Un mineur ne peut pas compléter son profil Google, et rien n'est enregistré.
- **A7** Une réactivation par un administrateur ne contourne pas les vérifications.
- **A8** Un ancien contenu n'a pas d'auteur, est marqué, et ne peut pas être relié à un compte.
- **A9** Un abonnement push n'est possible que pour un compte actif ; les adresses non sûres sont refusées ; dix appareils maximum.
- **A10** Un membre ne lit pas l'adresse secrète de ses abonnements push.
- **A11** Les préférences de notification ne peuvent pas désactiver les alertes de sécurité.
- **A12** Le formulaire de contact ne part pas sans consentement.
- **A13** La migration refuse de s'exécuter sans sauvegarde vérifiée (à écrire avec la migration).

État au 19 novembre 2026 : A1 à A11 sont couverts par des tests automatiques (base et navigateur). A12 est vérifié par la présence de la case obligatoire. A13 est à écrire.

## 12. Migration des anciennes publications [v2]

Conditions obligatoires, dans l'ordre :

1. **Sauvegarde complète** de la base de l'ancienne version (export intégral), avec un **manifeste** : liste des fichiers, taille, somme de contrôle (SHA-256) et nombre de documents par collection.
2. **Vérification de la sauvegarde** : ouverture de l'export, comptage, comparaison au manifeste. Sans vérification, la migration ne démarre pas.
3. **Copie de sécurité** conservée hors de l'environnement de production.
4. **Simulation** (passage à blanc) sur le projet de test, avec rapport : documents lus, migrés, ignorés, anomalies (images hors de notre compte, champs manquants).
5. **Accord écrit** du porteur du projet après lecture du rapport.
6. **Migration** : contenus marqués `is_legacy`, sans auteur, identifiant d'origine conservé pour éviter les doublons. Aucun nom de l'ancienne version n'est recopié (D7).
7. **Contrôle après migration** : nombres égaux au rapport, aucun contenu relié à un compte, affichage « ancien membre » vérifié.

La migration est réversible tant que la copie de sécurité existe. Elle ne s'exécute jamais sur la production sans les étapes 1 à 5.

## 13. Mise en ligne

Critères de sortie, tous obligatoires :

- Les tests automatiques passent (base, navigateur, sécurité).
- Les 16 tests du cahier initial et les tests A1 à A13 sont exécutés sur le projet de test, avec de vrais e-mails et de vrais SMS.
- Le domaine d'envoi est vérifié (SPF, DKIM, DMARC) ; le test « ailleurs que sur ta propre adresse » est réussi.
- Les règles Firestore de l'ancienne version ne sont plus ouvertes, et l'ancien site est retiré.
- Politique de confidentialité, CGU et mentions légales publiées, relues par un juriste.
- Sauvegardes automatiques actives et restauration testée.
- La clé secrète, la clé Resend, le secret du hook et les clés push sont dans les variables Vercel de production uniquement.

## 14. Suivi

L'avancement détaillé de chaque tâche, avec son responsable, est dans `docs/PRET-A-LANCER.md`.

## 15. Risques connus

- **Âge déclaratif** : la date de naissance est déclarée, elle n'est pas vérifiée par une pièce d'identité. Un mineur peut déclarer un âge faux. C'est une limite à présenter à un juriste, qui décidera si une vérification plus forte est nécessaire.
- **Anciens comptes** : les comptes de l'ancienne version ne sont pas migrés (mots de passe jamais transférés). Leurs anciennes publications le sont, sous « ancien membre ». Une personne mineure qui avait un compte devra donc s'inscrire à nouveau, et ne le pourra pas.
- **Coût des SMS** : environ 0,14 à 0,30 € par SMS vers le Togo selon les tarifs publiés. Pour 1 000 vérifications, comptez environ 135 à 300 €. Les codes sont limités à la vérification du téléphone, sans envoi publicitaire.
- **Formspree** : service externe provisoire. Son traitement est signalé aux membres (D5) ; il doit être remplacé et mentionné dans la politique de confidentialité.
- **Dépendance à Google** : la connexion Google dépend de la configuration du projet Google Cloud et de la disponibilité du service.

