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
| Espace membre, connexion, vote (`Member`, `SignIn`, `Vote`, ajoutés le 15 octobre 2026) | environ 100 chaînes | À relire en entier |
| Tableau de bord (menu) | Ojú-ìwé mi | Terme naturel pour « mon tableau de bord » ? |
| Tour (rotation des tables) | Ìyípo | |
| Pause (tour sans rencontre) | Ìsinmi | |
| Vote | Ìdìbò | Trop « électoral » pour un choix personnel ? |
| Sérieux (appréciation) | Ìfọkànsìn | |
| Ponctualité | Àsìkò | Terme plus précis possible ? |
| Se connecter / Se déconnecter | Wọlé / Jáde | |
| Paramètres | Ètò | |
| Page Soirées et paiement de démonstration (`Member.evenings`, `SimulatedPayment`, ajoutés le 16 octobre 2026) | environ 80 chaînes | À relire en entier |
| Confirmer sa place | Fìdí àyè múlẹ̀ | Formulation naturelle ? |
| Soirée thématique | Ìpàdé alẹ́ àkànṣe | |
| Paiement de démonstration | Ìsanwó àpẹẹrẹ | |
| Pages Notifications et Paramètres (`Member.notifications`, `Member.settings`, ajoutées le 16 octobre 2026) | environ 20 chaînes | À relire en entier |
| Mode sombre | Ìrísí òkùnkùn | Terme courant ? |
| Marquer comme lu | Sàmì sí pé a ti kà á | |
| Page Vérification (`Member.verification`, ajoutée le 17 octobre 2026) | environ 70 chaînes | À relire en entier |
| Texte de la déclaration sur l'honneur (`Member.verification.declaration.text`, version v1) | Mo búra pé... | Texte engageant : à relire avec attention dans les trois langues |
| Déclaration sur l'honneur | Ìbúra | |
| Divorcé(e) | Ẹni tí ìgbéyàwó rẹ̀ ti tú | Terme plus court ? |
| Veuf ou veuve | Opó | |
| Selfie | Fọ́tò ojú | |
| Mariage coutumier | Ìgbéyàwó ìbílẹ̀ | |
| Administration, coquille et Vérifications (`Admin`, ajoutée le 17 octobre 2026) | environ 90 chaînes | À relire en entier |
| Administration | Ìṣàkóso | |
| Modération / Super administration | Alábòójútó / Alákòóso àgbà | Termes d'usage dans une équipe ? |
| Pluriels des places (« 1 place libre ») | àyè # ló kù | Le yoruba n'a pas de forme « one » distincte : une seule forme suffit-elle ? |
| Administration, Soirées et Lieux (`Admin.evenings`, `Admin.venues`, ajoutées le 19 octobre 2026) | environ 130 chaînes | À relire en entier |
| Brouillon (soirée non publiée) | Àkọsílẹ̀ àkọ́kọ́ | Terme d'usage ? |
| Publier | Tẹ̀ jáde | |
| Pointer (enregistrer l'arrivée) | Kọ wíwá sílẹ̀ | Formulation naturelle ? |
| Tour (rotation des tables) | Ìyípo | |
| Lieu partenaire | Ibi ìpàdé alábàáṣiṣẹ́pọ̀ | |
| Administration, Membres (`Admin.members`, ajoutée le 19 octobre 2026) | environ 110 chaînes | À relire en entier |
| Suspendre / Exclure (un membre) | Dá dúró / Yọ kúrò | Termes justes pour une sanction ? |
| Soirée publiée modifiée ou annulée (`Admin.evenings.cancel`, `Member.bell.kinds`, ajoutées le 19 octobre 2026) | environ 15 chaînes | À relire en entier |
| Annuler (une soirée) | Fagilé | |
| Rembourser en entier | Dá owó padà lẹ́kùnrẹ́rẹ́ | |
| Codes QR des tables (`Admin.evenings.tables`, ajoutée le 19 octobre 2026) | environ 10 chaînes | Texte imprimé sur les tables, lu par les participants : à relire avec attention |
| Paiements (`Admin.payments`, ajoutée le 19 octobre 2026) | environ 35 chaînes | À relire en entier |
| Rapprochement (avec le prestataire) | Ìbáramu | Terme comptable d'usage ? |
| Recherche globale, filtres avancés, export (`Admin.search`, `Admin.members.advanced`, `Admin.members.export`, ajoutées le 19 octobre 2026) | environ 110 chaînes | À relire en entier |
| Actions groupées (`Admin.members.bulk`) et messages reçus (`Member.bell.kinds`), ajoutées le 19 octobre 2026 | environ 45 chaînes | À relire en entier |
| Inscription (`Register`) et adresse e-mail (`Member.settings.email`), ajoutées le 19 octobre 2026 | environ 50 chaînes | Texte du consentement à relire avec attention |
| SMS et e-mails des actions groupées (`apps/api/src/notifications/team-messages.ts`) | 6 phrases | Envoyées telles quelles aux membres : à relire avec attention |
| Page de paiement KkiaPay (`Payment`, ajoutée le 20 octobre 2026) | environ 30 chaînes | Messages d'argent : à relire avec attention |

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
