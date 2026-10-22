-- =====================================================================
-- Suppression des membres de démonstration créés par membres-demo.sql
-- (adresses en @demo.ifedele.invalid) et de la soirée de démonstration de soiree-demo.sql
-- (lieu « Lieu de démonstration (fictif) »). Aucun autre compte ni aucune autre soirée
-- n'est touché.
-- À exécuter dans Supabase > SQL Editor. Tout ou rien : en cas d'erreur, rien n'est supprimé.
-- =====================================================================

begin;

do $$
declare
  fk record;
  v_count integer;
begin
  create temporary table demo_ids on commit drop as
    select id from auth.users where email like '%@demo.ifedele.invalid';

  -- Leurs réservations pointent vers leurs paiements : lien retiré avant la suppression
  update app.event_registrations set payment_id = null where user_id in (select id from demo_ids);

  -- Lignes qui les concernent dans les tables liées sans suppression en cascade
  -- (réservations, notifications envoyées par l'équipe, etc.). Le journal garde ses lignes.
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'app.users'::regclass and c.confdeltype in ('a', 'r')
  loop
    if fk.tbl = 'app.audit_log'::regclass then
      execute format('update %s set %I = null where %I in (select id from demo_ids)', fk.tbl, fk.col, fk.col);
    else
      execute format('delete from %s where %I in (select id from demo_ids)', fk.tbl, fk.col);
    end if;
  end loop;

  -- Le reste (app.users, profil, vérification...) suit par suppression en cascade
  delete from auth.users where id in (select id from demo_ids);
  get diagnostics v_count = row_count;
  perform app.audit('member.demo_deleted', 'users', null, jsonb_build_object('count', v_count));

  -- Soirée de démonstration : tables, tours et votes suivent par suppression en cascade
  delete from app.events where venue_id in (select id from app.venues where name = 'Lieu de démonstration (fictif)');
  delete from app.venues where name = 'Lieu de démonstration (fictif)';
end $$;

commit;

select count(*) as membres_demo_restants from auth.users where email like '%@demo.ifedele.invalid';
