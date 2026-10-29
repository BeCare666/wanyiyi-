-- Choix A à G de la phase 4, validés le 28 octobre 2026
-- (propositions/PROPOSITIONS-CHOIX-A-G-PHASE4.txt). A, D, F et G restent comme en place.
--   B. Réduction de parrainage refusée si elle atteint le prix par défaut d'une soirée
--      (10 000 FCFA, DEFAULT_PRICE_XOF du site) : une soirée ne tombe jamais à 0 FCFA.
--   C. Minimum par demande de reversement tant que la cagnotte est ouverte : 10 000 FCFA,
--      réglable ; aucun minimum une fois la cagnotte close (pour solder).
--   E. Badge « Profil complet » aligné sur la barre de progression de l'éditeur de profil
--      (apps/web/.../profil/profile.ts) : les deux côtés à 100 % (catégories obligatoires, au moins
--      3 personnalités pour « Je me décris », les 3 textes écrits) et une photo approuvée.

insert into app.settings (key, value) values ('cagnotte.min_payout_xof', '10000')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- B. Réglages du parrainage
-- ---------------------------------------------------------------------
create or replace function app.admin_set_referral_settings(p_reward_xof integer, p_max_per_year integer) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reward_xof is null or p_reward_xof not between 0 and 1000000 then raise exception 'invalid_amount'; end if;
  -- Choix B : la réduction reste inférieure au prix par défaut d'une soirée
  if p_reward_xof >= 10000 then raise exception 'reward_too_high'; end if;
  if p_max_per_year is null or p_max_per_year not between 0 and 100 then raise exception 'invalid_limit'; end if;
  insert into app.settings (key, value, updated_by, updated_at) values
    ('referral.reward_xof', to_jsonb(p_reward_xof), auth.uid(), now()),
    ('referral.max_rewarded_per_year', to_jsonb(p_max_per_year), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform app.audit('referral.settings', 'settings', null, jsonb_build_object('reward_xof', p_reward_xof, 'max_per_year', p_max_per_year));
end $$;

-- ---------------------------------------------------------------------
-- C. Minimum de reversement tant que la cagnotte est ouverte
-- ---------------------------------------------------------------------
drop function if exists app.cagnotte_settings();
create function app.cagnotte_settings()
returns table (min_contribution_xof integer, commission_percent numeric, min_payout_xof integer)
language sql stable security definer set search_path = app, public as $$
  select app.setting_int('cagnotte.min_contribution_xof', 1000), app.cagnotte_commission_percent(), app.setting_int('cagnotte.min_payout_xof', 10000)
$$;

drop function if exists app.admin_set_cagnotte_settings(integer, numeric);
create function app.admin_set_cagnotte_settings(p_min_contribution_xof integer, p_commission_percent numeric, p_min_payout_xof integer) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('cagnottes.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_min_contribution_xof is null or p_min_contribution_xof not between 100 and 10000000 then raise exception 'invalid_amount'; end if;
  if p_commission_percent is null or p_commission_percent < 0 or p_commission_percent > 50 or p_commission_percent <> round(p_commission_percent, 2) then
    raise exception 'invalid_commission';
  end if;
  if p_min_payout_xof is null or p_min_payout_xof not between 0 and 10000000 then raise exception 'invalid_min_payout'; end if;
  insert into app.settings (key, value, updated_by, updated_at) values
    ('cagnotte.min_contribution_xof', to_jsonb(p_min_contribution_xof), auth.uid(), now()),
    ('cagnotte.commission_percent', to_jsonb(p_commission_percent), auth.uid(), now()),
    ('cagnotte.min_payout_xof', to_jsonb(p_min_payout_xof), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform app.audit('cagnotte.settings', 'settings', null,
    jsonb_build_object('min_contribution_xof', p_min_contribution_xof, 'commission_percent', p_commission_percent, 'min_payout_xof', p_min_payout_xof));
end $$;

-- Demande de reversement contrôlée dès le premier des deux : rien à reverser, ou montant sous le
-- minimum tant que la cagnotte est ouverte
create or replace function app.cagnotte_decide(p_cagnotte uuid, p_kind text) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_cagnotte app.cagnottes;
  v_couple app.couples;
  v_gross integer;
  v_payout uuid;
begin
  select * into v_cagnotte from app.cagnottes where id = p_cagnotte for update;
  select * into v_couple from app.couples where id = v_cagnotte.couple_id;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if p_kind not in ('close', 'payout') then raise exception 'invalid_kind'; end if;
  if v_couple.status not in ('active', 'paused', 'union_celebrated') or v_couple.blocked_at is not null then raise exception 'invalid_status'; end if;
  if p_kind = 'close' and v_cagnotte.status <> 'open' then raise exception 'invalid_status'; end if;
  if p_kind = 'payout' and v_cagnotte.status not in ('open', 'closed') then raise exception 'invalid_status'; end if;
  if p_kind = 'payout' and exists (select 1 from app.cagnotte_payouts o where o.cagnotte_id = p_cagnotte and o.status = 'requested') then
    raise exception 'payout_pending';
  end if;
  if p_kind = 'payout' then
    -- Contributions reçues pas encore reversées
    select coalesce(sum(c.amount_xof), 0)::integer into v_gross
    from app.contributions c join app.payments p on p.id = c.payment_id
    where c.cagnotte_id = p_cagnotte and p.status = 'succeeded' and c.payout_id is null;
    if v_gross = 0 then raise exception 'nothing_to_pay_out'; end if;
    -- Choix C : minimum tant que la cagnotte est ouverte
    if v_cagnotte.status = 'open' and v_gross < app.setting_int('cagnotte.min_payout_xof', 10000) then raise exception 'payout_too_small'; end if;
  end if;

  insert into app.cagnotte_requests (cagnotte_id, user_id, kind) values (p_cagnotte, v_uid, p_kind) on conflict do nothing;
  if (select count(*) from app.cagnotte_requests r where r.cagnotte_id = p_cagnotte and r.kind = p_kind and r.user_id in (v_couple.member_a, v_couple.member_b)) < 2 then
    perform app.notify_with_deliveries(case when v_uid = v_couple.member_a then v_couple.member_b else v_couple.member_a end,
      'cagnotte.' || p_kind || '_requested', jsonb_build_object('couple_id', v_couple.id));
    return 'recorded';
  end if;
  delete from app.cagnotte_requests where cagnotte_id = p_cagnotte and kind = p_kind;

  if p_kind = 'close' then
    update app.cagnottes set status = 'closed', closed_at = now(), closed_reason = 'couple' where id = p_cagnotte;
    perform app.audit('cagnotte.closed', 'cagnottes', p_cagnotte, jsonb_build_object('reason', 'couple'));
    return 'closed';
  end if;

  insert into app.cagnotte_payouts (cagnotte_id, gross_xof, commission_xof, payout_phone)
  values (p_cagnotte, v_gross, floor(v_gross * v_cagnotte.commission_percent / 100)::integer, v_cagnotte.payout_phone)
  returning id into v_payout;
  update app.contributions c set payout_id = v_payout
    from app.payments p
   where p.id = c.payment_id and c.cagnotte_id = p_cagnotte and p.status = 'succeeded' and c.payout_id is null;
  perform app.audit('cagnotte.payout_requested', 'cagnotte_payouts', v_payout, jsonb_build_object('gross_xof', v_gross));
  return 'payout_requested';
end $$;

-- ---------------------------------------------------------------------
-- E. « Profil complet » = barre de progression de l'éditeur à 100 % des deux côtés
-- ---------------------------------------------------------------------
-- Catégories obligatoires du catalogue (packages/shared/src/profile-catalog.ts, optional: false) ;
-- taille, silhouette et revenus sont facultatives. Personnalité : au moins 3 choix pour soi.
create or replace function app.profile_complete(p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  with required(category) as (values
    ('marital_status'), ('children'), ('wants_children'), ('intention'), ('timeline'), ('religion'), ('religious_practice'),
    ('education'), ('sector'), ('languages'), ('personality'), ('tobacco'), ('alcohol'), ('going_out'), ('interests'),
    ('money_management'), ('extended_family'), ('desired_location'))
  select
    (select count(distinct t.field) from app.profile_texts t where t.user_id = p_user and btrim(t.body) <> '') = 3
    and (select count(*) from required r join app.profile_answers a
           on a.user_id = p_user and a.side = 'self' and a.category = r.category
          where cardinality(a.values) >= case when r.category = 'personality' then 3 else 1 end) = (select count(*) from required)
    and (select count(*) from required r join app.profile_answers a
           on a.user_id = p_user and a.side = 'seeking' and a.category = r.category
          where cardinality(a.values) > 0) = (select count(*) from required)
$$;

revoke execute on function app.profile_complete(uuid) from public;
grant execute on function
  app.admin_set_referral_settings(integer, integer),
  app.cagnotte_settings(),
  app.admin_set_cagnotte_settings(integer, numeric, integer),
  app.cagnotte_decide(uuid, text)
to authenticated, service_role;
