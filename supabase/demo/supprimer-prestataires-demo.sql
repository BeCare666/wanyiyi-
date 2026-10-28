-- =====================================================================
-- Suppression des prestataires de démonstration créés par prestataires-demo.sql
-- (is_demo vrai). Les « J'ai contacté » qui les visent sont supprimés avec eux. Aucun autre
-- prestataire n'est touché. Leurs images éventuelles restent sur Cloudinary : à effacer à la
-- main si l'équipe en a déposé.
-- À exécuter dans Supabase > SQL Editor. Tout ou rien.
-- =====================================================================

begin;

delete from app.providers where is_demo;

commit;
