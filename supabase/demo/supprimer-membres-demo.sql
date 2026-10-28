-- =====================================================================
-- Suppression des membres de démonstration créés par membres-demo.sql
-- (adresses en @demo.ifedele.invalid) et de la soirée de démonstration de soiree-demo.sql
-- (lieu « Lieu de démonstration (fictif) »). Aucun autre compte ni aucune autre soirée
-- n'est touché.
-- À exécuter dans Supabase > SQL Editor. Tout ou rien : en cas d'erreur, rien n'est supprimé.
-- =====================================================================

begin;

-- Suppression d'un ensemble de lignes et, d'abord, de tout ce qui en dépend sans suppression en
-- cascade (découvertes d'un match, couples, conversations, cagnottes...). Le journal garde ses
-- lignes (lien retiré). Fonction temporaire, disparaît à la fin de la session.
create function pg_temp.purge(p_table regclass, p_where text, p_depth integer default 0) returns void
language plpgsql as $$
declare fk record;
begin
  if p_depth > 8 then return; end if;
  for fk in
    select c.conrelid::regclass as child, a.attname as col, af.attname as refcol
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
    where c.contype = 'f' and c.confrelid = p_table and c.confdeltype in ('a', 'r') and cardinality(c.conkey) = 1
      and c.conrelid <> p_table
  loop
    if fk.child = 'app.audit_log'::regclass then
      execute format('update %s set %I = null where %I in (select %I from %s where %s)', fk.child, fk.col, fk.col, fk.refcol, p_table, p_where);
    else
      perform pg_temp.purge(fk.child, format('%I in (select %I from %s where %s)', fk.col, fk.refcol, p_table, p_where), p_depth + 1);
    end if;
  end loop;
  execute format('delete from %s where %s', p_table, p_where);
end $$;

do $$
declare
  fk record;
  v_count integer;
begin
  create temporary table demo_ids on commit drop as
    select id from auth.users where email like '%@demo.ifedele.invalid';

  -- Leurs réservations pointent vers leurs paiements : lien retiré avant la suppression
  update app.event_registrations set payment_id = null where user_id in (select id from demo_ids);

  -- Phase 4 (parcours-demo.sql) : cagnottes de leurs couples, avec contributions, paiements des
  -- contributions et reversements ; réductions et liens de parrainage
  create temporary table demo_cagnottes on commit drop as
    select g.id from app.cagnottes g join app.couples c on c.id = g.couple_id
     where c.member_a in (select id from demo_ids) or c.member_b in (select id from demo_ids);
  create temporary table demo_contribution_payments on commit drop as
    select payment_id as id from app.contributions where cagnotte_id in (select id from demo_cagnottes) and payment_id is not null;
  delete from app.cagnotte_requests where cagnotte_id in (select id from demo_cagnottes);
  delete from app.contributions where cagnotte_id in (select id from demo_cagnottes);
  delete from app.cagnotte_payouts where cagnotte_id in (select id from demo_cagnottes);
  delete from app.payments where id in (select id from demo_contribution_payments);
  delete from app.cagnottes where id in (select id from demo_cagnottes);
  delete from app.member_credits
   where user_id in (select id from demo_ids)
      or referral_id in (select id from app.referrals where referrer_id in (select id from demo_ids) or referred_id in (select id from demo_ids));
  delete from app.referrals where referrer_id in (select id from demo_ids) or referred_id in (select id from demo_ids);

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
      perform pg_temp.purge(fk.tbl, format('%I in (select id from demo_ids)', fk.col));
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
