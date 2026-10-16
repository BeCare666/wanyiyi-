-- Phase 2, étape 4 : selfie de vérification (décision du 17 octobre 2026 : visage seul).
-- Seule instruction du fichier : une nouvelle valeur d'énumération n'est utilisable
-- qu'après la validation de la transaction qui l'ajoute (migration suivante).
alter type app.document_kind add value 'selfie';
