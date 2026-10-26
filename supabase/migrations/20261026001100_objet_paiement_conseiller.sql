-- Phase 3 : nouvel objet de paiement « accès au conseiller » (règles de l'utilisateur du 26 octobre
-- 2026). Migration séparée : une valeur d'énumération ne peut pas servir dans la transaction qui
-- l'ajoute ; elle est utilisée par la migration suivante.
alter type app.payment_purpose add value if not exists 'counselor_access';
