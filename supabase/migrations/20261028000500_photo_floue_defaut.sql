-- Décision du 28 octobre 2026 : les photos de profil sont floutées par défaut pour les autres
-- membres (matchs, découvertes, couple) ; chacun peut retirer le flou dans ses paramètres
-- (« Garder ma photo floutée »). Le selfie reste réservé à la vérification, inchangé.
-- S'applique aux comptes créés à partir de maintenant ; le choix déjà enregistré des membres
-- existants n'est pas modifié.
alter table app.member_profiles alter column keep_photo_blurred set default true;
