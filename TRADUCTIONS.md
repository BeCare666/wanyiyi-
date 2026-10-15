# Traductions

Langue source : **français** (`apps/web/messages/fr.json`).
Toutes les chaînes visibles passent par ces fichiers. Aucun texte n'est codé en dur dans les composants
(seule exception : la page interne `/design-system`, documentation réservée à l'équipe).

| Langue | Fichier | État |
| --- | --- | --- |
| Français | `fr.json` | Rédigé, à relire par vous |
| Anglais | `en.json` | Traduit, à relire |
| Yoruba | `yo.json` | **Brouillon : à valider par un traducteur natif** |

## Yoruba : points à valider en priorité

Toutes les chaînes yoruba sont à valider. Les choix de vocabulaire ci-dessous méritent une attention particulière.

| Notion | Traduction proposée | Question pour le traducteur |
| --- | --- | --- |
| Match mutuel | Ìfohùnṣọ̀kan | Le terme rend-il bien « accord des deux » ? |
| Phase découverte | Àkókò ìmọ̀ra | Formulation naturelle ? |
| Espace du couple | Ààyè ìbáṣepọ̀ | Préférez-vous un terme évoquant le couple engagé ? |
| Espace souvenir | Ààyè ìrántí | |
| Conseiller de couple | Olùdámọ̀ràn | |
| Dot | Ìdána | Adapté au contexte béninois (Fon, Goun, Yoruba du Bénin) ? |
| Filigrane | Àmì orúkọ | |
| Devenir membre | Di ọmọ ẹgbẹ́ | |
| Soirée | Ìpàdé alẹ́ | |
| Liste d'attente | Àkójọ ìdúró | |
| Signalement | Ẹ̀sùn / ìfẹ̀sùnsùn | Le terme est-il trop fort (connotation judiciaire) ? |
| « À compléter » | À ń parí rẹ̀ | |
| Pluriel des places | `{count, plural, =0 {Ó ti kún} other {Àyè #}}` | Le yoruba n'a qu'une forme « other » (règles CLDR) : à confirmer |
| Accueil (menu) | Ìbẹ̀rẹ̀ | Terme courant pour la page d'accueil d'un site ? |
| La maison (menu) | Ilé wa | |
| Mon espace | Àyè mi | |
| Règlement (menu) | Òfin | |
| Nous suivre | Ẹ tẹ̀lé wa | |
| Lien à venir | Ìjápọ̀ ń bọ̀ | |
| Photographie de… | Fọ́tò láti ọwọ́ … | |
| Descriptions du menu (`Nav.hints`) | 9 phrases courtes | À relire en entier dans `messages/yo.json` |
| Drapeau du yoruba | Bénin | Validé le 14 octobre 2026 |
| Chiffres en lettres (blocage des numéros, `packages/domain/src/textGuard.ts`) | òdo, ọ̀kan, èjì, ẹ̀ta, ẹ̀rin, àrún, ẹ̀fà, èje, ẹ̀jọ, ẹ̀sán | Liste complète ? Autres façons courantes d'écrire un numéro ? |
| Code OTP par SMS et e-mails de confirmation (`apps/api/src/notifications/messages.ts`) | 1 SMS et 4 e-mails | À relire en entier |

## Règles de rédaction appliquées à toutes les langues

- Aucun tiret long, demi-cadratin ou double tiret (vérifié par `apps/web/tests/copywriting.test.ts`).
- Aucune formule creuse (« découvrez », « libérez », « boostez », etc.), vérifiée pour le français et l'anglais.
- Vouvoiement en français, forme de respect « ẹ / yín » en yoruba.
- Les trois fichiers doivent avoir exactement les mêmes clés (vérifié par les tests).

## Formats

- Fuseau horaire : Africa/Porto-Novo (UTC+1, Cotonou).
- Montants : franc CFA (XOF), sans décimales, format propre à chaque langue.
- Dates de soirée : jour de la semaine, jour et mois, puis l'heure.

## Correction depuis l'administration

Prévu en phase 2 : table `translations` (déjà dans le modèle de données) et module « Contenus de la vitrine
et traductions » de l'administration. Les valeurs en base surchargeront celles des fichiers.
