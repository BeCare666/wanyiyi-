-- Demande du 10/11/2026 : nouvel objet de paiement « message au conseiller » (demande seule,
-- 200 FCFA par message après les messages gratuits). Migration séparée : une valeur
-- d'énumération ne peut pas servir dans la transaction qui l'ajoute.
alter type app.payment_purpose add value if not exists 'counsel_message';
