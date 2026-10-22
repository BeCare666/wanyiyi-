-- =====================================================================
-- Membres de démonstration : 12 femmes et 12 hommes (décision du 21 octobre 2026,
-- question 28 d de PHASE2.txt ; 4 de plus le 22 octobre, question 31, pour la liste
-- d'attente de la soirée de démonstration soiree-demo.sql).
--   - profils fictifs béninois, statut « vérifié », étape « soirées » ;
--   - aucun mot de passe : personne ne peut se connecter à ces comptes ;
--   - adresses e-mail fictives en @demo.ifedele.invalid (le domaine .invalid n'existe
--     pas : aucun e-mail ne peut y être remis) ;
--   - repérables par cette adresse et par "demo": true dans les métadonnées ;
--   - supprimables d'un coup avec supabase/demo/supprimer-membres-demo.sql.
-- À exécuter dans Supabase > SQL Editor. Seuls les membres absents sont créés : après la
-- première version (20 membres), une nouvelle exécution ajoute les 4 derniers.
-- Refusé si les 24 sont déjà présents.
-- =====================================================================

begin;

do $$
declare
  r record;
  v_id uuid;
begin
  if (select count(*) from auth.users where email like '%@demo.ifedele.invalid') >= 24 then
    raise exception 'Membres de démonstration déjà présents : exécuter d''abord supprimer-membres-demo.sql';
  end if;

  for r in
    select * from (values
      ('demo-f01', 'Afiavi',    'Houngbédji',  'female', date '1994-03-12', 'Cotonou'),
      ('demo-f02', 'Sènami',    'Agossou',     'female', date '1991-07-25', 'Abomey-Calavi'),
      ('demo-f03', 'Ayaba',     'Dossou',      'female', date '1996-11-02', 'Porto-Novo'),
      ('demo-f04', 'Fifamè',    'Hounkpatin',  'female', date '1989-05-18', 'Cotonou'),
      ('demo-f05', 'Adjoavi',   'Tossou',      'female', date '1993-09-30', 'Ouidah'),
      ('demo-f06', 'Yétondé',   'Ahouansou',   'female', date '1997-01-14', 'Cotonou'),
      ('demo-f07', 'Kémi',      'Adéyèmi',     'female', date '1990-12-08', 'Porto-Novo'),
      ('demo-f08', 'Folake',    'Ogoundélé',   'female', date '1995-04-21', 'Parakou'),
      ('demo-f09', 'Mahouna',   'Gbaguidi',    'female', date '1992-08-03', 'Bohicon'),
      ('demo-f10', 'Nadège',    'Kpodékon',    'female', date '1988-10-27', 'Cotonou'),
      ('demo-f11', 'Houéfa',    'Zinsou',      'female', date '1996-06-09', 'Abomey'),
      ('demo-f12', 'Mariam',    'Bachabi',     'female', date '1991-02-24', 'Djougou'),
      ('demo-h01', 'Koffi',     'Hounsou',     'male',   date '1990-02-11', 'Cotonou'),
      ('demo-h02', 'Sèna',      'Akplogan',    'male',   date '1987-06-19', 'Abomey-Calavi'),
      ('demo-h03', 'Codjo',     'Sossou',      'male',   date '1992-10-05', 'Porto-Novo'),
      ('demo-h04', 'Mawulé',    'Hounyèmè',    'male',   date '1989-03-28', 'Cotonou'),
      ('demo-h05', 'Rodrigue',  'Kiki',        'male',   date '1993-12-16', 'Ouidah'),
      ('demo-h06', 'Dossa',     'Gnonlonfoun', 'male',   date '1986-08-09', 'Bohicon'),
      ('demo-h07', 'Babatundé', 'Olatoundji',  'male',   date '1991-05-02', 'Porto-Novo'),
      ('demo-h08', 'Gildas',    'Avocè',       'male',   date '1994-07-23', 'Cotonou'),
      ('demo-h09', 'Ismaël',    'Sanni',       'male',   date '1988-11-30', 'Parakou'),
      ('demo-h10', 'Hervé',     'Dégbé',       'male',   date '1995-01-17', 'Cotonou'),
      ('demo-h11', 'Comlan',    'Adjovi',      'male',   date '1990-09-13', 'Lokossa'),
      ('demo-h12', 'Yaovi',     'Houénou',     'male',   date '1987-04-06', 'Abomey-Calavi')
    ) as t(handle, first_name, last_name, sex, birth_date, city)
    where not exists (select 1 from auth.users u where u.email = t.handle || '@demo.ifedele.invalid')
  loop
    v_id := gen_random_uuid();
    -- Compte Supabase Auth sans mot de passe. Les champs de jeton sont des chaînes vides,
    -- comme pour un compte créé par Supabase (vides, ils casseraient la liste des comptes).
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      r.handle || '@demo.ifedele.invalid', '',
      '{"provider": "email", "providers": ["email"], "demo": true}', '{"locale": "fr", "demo": true}', now(), now(),
      '', '', '', ''
    );
    -- app.users est créé par le déclencheur on_auth_user_created (numéro de membre compris)
    update app.users set consent_at = now() where id = v_id;
    insert into app.member_profiles (user_id, first_name, last_name, sex, birth_date, city, status, journey_stage)
    values (v_id, r.first_name, r.last_name, r.sex::app.sex, r.birth_date, r.city, 'verified', 'evenings');
    insert into app.verifications (user_id, status, decided_at) values (v_id, 'approved', now());
    perform app.audit('member.demo_created', 'users', v_id, '{"demo": true}');
  end loop;
end $$;

commit;

select p.sex, count(*) as membres_demo
from app.member_profiles p join auth.users u on u.id = p.user_id
where u.email like '%@demo.ifedele.invalid'
group by p.sex order by p.sex;
