-- =====================================================================
-- Prestataires de démonstration (phase 4, question 2 e, validée le 27 octobre 2026) :
-- 8 prestataires fictifs, 2 par catégorie de la vitrine (traiteurs, couturiers, photographes,
-- lieux de réception).
--   - marqués « démonstration » (is_demo) et « (démo) » dans leur nom : cachés de la vitrine
--     et de l'espace membre quand SHOW_DEMO_DATA est faux en production ;
--   - numéros fictifs (aucun n'appartient à une vraie personne), sans image ;
--   - supprimés par supprimer-prestataires-demo.sql.
-- À exécuter dans Supabase > SQL Editor, après la migration 20261028000100_prestataires.sql.
-- Ré-exécutable : un prestataire de démonstration déjà présent (même nom) n'est pas recréé.
-- =====================================================================

begin;

insert into app.providers (name, category, description, phone, whatsapp, city, district, price_range, is_demo)
select v.name, v.category, v.description::jsonb, v.phone, v.whatsapp, v.city, v.district, v.price_range, true
from (values
  ('Saveurs du Littoral (démo)', 'caterer',
   '{"fr": "Cuisine béninoise et africaine pour les dots, mariages et réceptions, de 50 à 500 invités.", "en": "Beninese and African food for dowry ceremonies, weddings and receptions, from 50 to 500 guests."}',
   '+2290100000001', '+2290100000001', 'Cotonou', 'Fidjrossè', 'À partir de 3 500 FCFA par invité'),
  ('La Table de Porto-Novo (démo)', 'caterer',
   '{"fr": "Buffets et cocktails, pâtisseries et gâteaux de mariage sur commande.", "en": "Buffets and cocktails, pastries and wedding cakes made to order."}',
   '+2290100000002', null, 'Porto-Novo', 'Ouando', null),
  ('Atelier Pagne et Soie (démo)', 'tailor',
   '{"fr": "Tenues assorties pour le couple et les familles, en pagne, bazin et dentelle.", "en": "Matching outfits for the couple and families, in wax, bazin and lace."}',
   '+2290100000003', '+2290100000003', 'Cotonou', 'Cadjèhoun', 'À partir de 25 000 FCFA la tenue'),
  ('Couture Élégance (démo)', 'tailor',
   '{"fr": "Robes de mariée et costumes sur mesure, retouches comprises.", "en": "Made-to-measure wedding dresses and suits, alterations included."}',
   null, '+2290100000004', 'Abomey-Calavi', 'Godomey', null),
  ('Studio Lumière (démo)', 'photographer',
   '{"fr": "Photo et vidéo de la dot, du mariage civil et religieux, album remis en 30 jours.", "en": "Photo and video of the dowry, civil and religious wedding, album delivered in 30 days."}',
   '+2290100000005', '+2290100000005', 'Cotonou', 'Haie Vive', 'À partir de 150 000 FCFA'),
  ('Regards d''Ouidah (démo)', 'photographer',
   '{"fr": "Reportage photo discret, portraits du couple et des familles.", "en": "Discreet photo coverage, portraits of the couple and families."}',
   '+2290100000006', null, 'Ouidah', null, null),
  ('Jardin des Cocotiers (démo)', 'reception_venue',
   '{"fr": "Jardin et salle couverte jusqu''à 400 invités, parking surveillé.", "en": "Garden and indoor hall for up to 400 guests, guarded parking."}',
   '+2290100000007', '+2290100000007', 'Cotonou', 'Akpakpa', 'Sur devis'),
  ('Salle des Lagunes (démo)', 'reception_venue',
   '{"fr": "Salle climatisée de 200 places, cuisine équipée à disposition du traiteur.", "en": "Air-conditioned hall for 200 guests, equipped kitchen available to the caterer."}',
   '+2290100000008', null, 'Porto-Novo', 'Djègan-Kpèvi', null)
) as v(name, category, description, phone, whatsapp, city, district, price_range)
where not exists (select 1 from app.providers p where p.name = v.name and p.is_demo);

select name, category, city from app.providers where is_demo order by category, name;

commit;
