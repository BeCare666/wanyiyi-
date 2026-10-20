# Wanyiyi

Maison de rencontres sérieuses à Cotonou : membres vérifiés, rencontres en face à face,
accompagnement jusqu'à l'union.

## Organisation du dépôt

```
apps/
  web/        Next.js 16 (App Router), vitrine, espace membre, conseiller, administration
  api/        NestJS : logique métier, tâches planifiées, paiements, notifications, filigrane
packages/
  shared/     règles métier (constantes), catalogue du profil, rôles : partagés web et api
supabase/
  migrations/ schéma SQL complet (toutes phases), RLS activée sur toutes les tables
propositions/ propositions techniques et logo validés
PHOTOS.md     photos de la vitrine : emplacements, consignes, crédits
TRADUCTIONS.md état des traductions (yoruba à valider)
```

## Démarrer

Prérequis : Node.js 20.9 ou plus récent.

```bash
npm install
npm run dev:web     # http://localhost:3000 (fr), /en, /yo
npm run dev:api     # http://localhost:4000/api/health
npm test            # tests de tous les paquets
```

Variables d'environnement : copier `apps/api/.env.example` en `apps/api/.env`
et `apps/web/.env.example` en `apps/web/.env.local`.

## Choix structurants

- **Requêtes typées Supabase** plutôt que Prisma : toutes les requêtes faites au nom d'un membre
  passent par la Row Level Security (jeton du membre transmis par l'API).
  La clé service role est réservée aux tâches système, chaque usage est journalisé.
- **Cloudinary** : photos de la vitrine uniquement. Photos des membres et pièces d'identité :
  Supabase Storage privé, URL signées de 5 minutes, filigrane généré par l'API.
- **Brevo** : e-mails (confirmation d'inscription et mot de passe oublié via le Send Email Hook de Supabase,
  notifications), SMS de notification, WhatsApp. Inscription et connexion par e-mail et mot de passe (20 octobre 2026).
- **Polices** : EB Garamond (titres) et Montserrat (texte), hébergées dans le projet. Jost a été écartée car elle
  n'affiche pas ẹ, ọ, ṣ (vérification de la table des caractères des fichiers de police).
  Cormorant Garamond a été écartée car ses accents sont mal placés au rendu (ô, ù, é), vérifié dans Chromium.
- **Schéma `app`** : les tables sont dans un schéma dédié, à exposer dans les réglages API de Supabase.

## Avancement

| Phase | Contenu | État |
| --- | --- | --- |
| 1 | Système de design, vitrine complète, multilingue, PWA, socle API, schéma complet | En validation |
| 2 | Inscription, vérification, profil, soirées, paiement, vote QR, matchs, administration de base | À venir |
| 3 | Découverte, espace du couple, chat, conseillers, signalements, filtres avancés | À venir |
| 4 | Parrainage et badges, prestataires, cagnotte, espace souvenir | À venir |
