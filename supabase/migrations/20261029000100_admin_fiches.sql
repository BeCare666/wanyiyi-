-- Fiches de l'administration (décisions du 29 octobre 2026) :
--   a) Détail d'un membre pour décider, sur sa fiche et sur son dossier de vérification : adresse
--      e-mail, réponses du profil (moi et recherché, critères non négociables), textes et photos
--      du profil avec leur état de relecture. Permission members.manage ou verifications.review.
--   b) Suppression immédiate d'un compte par la super administration (permission accounts.delete) :
--      motif obligatoire et journalisé, sans délai ni retour. Même effacement que la suppression
--      demandée par le membre (question 17), fait tout de suite : la base est effacée ici, l'API
--      efface ensuite les fichiers et le compte Supabase Auth (app.accounts_to_clean).
--      Règles reprises de la demande du membre : soirée à venir annulée d'abord, découverte et
--      couple en cours clôturés avec l'autre membre prévenu. Jamais son propre compte ; un compte
--      de l'équipe repasse d'abord au rôle de membre.

-- ---------------------------------------------------------------------
-- a) Détail d'un membre
-- ---------------------------------------------------------------------
create function app.admin_member_details(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not (app.has_permission('members.manage') or app.has_permission('verifications.review')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'email', (select email from auth.users where id = p_user),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('side', side, 'category', category, 'values', to_jsonb("values")) order by side, category)
      from app.profile_answers where user_id = p_user), '[]'::jsonb),
    'dealbreakers', coalesce((select jsonb_agg(category order by category) from app.dealbreakers where user_id = p_user), '[]'::jsonb),
    'texts', coalesce((
      select jsonb_agg(jsonb_build_object('field', field, 'body', body, 'review_status', review_status, 'review_note', review_note) order by field)
      from app.profile_texts where user_id = p_user), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('photo_id', id, 'review_status', review_status, 'review_note', review_note) order by position, created_at)
      from app.photos where user_id = p_user), '[]'::jsonb)
  );
end $$;
revoke execute on function app.admin_member_details(uuid) from public;
grant execute on function app.admin_member_details(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- b) Suppression immédiate par la super administration
-- ---------------------------------------------------------------------
insert into app.role_permissions (role, permission) values ('super_admin', 'accounts.delete')
on conflict do nothing;

-- Effacement des données d'un compte en base (repris de app.purge_deleted_accounts) : paiements et
-- journal d'audit gardés sans nom ; la ligne app.users reste pour les clés étrangères.
create function app.erase_account_data(p_user uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  delete from app.votes where voter_id = p_user;
  delete from app.notifications where user_id = p_user;
  delete from app.notification_preferences where user_id = p_user;
  delete from app.profile_texts where user_id = p_user;
  delete from app.profile_answers where user_id = p_user;
  delete from app.dealbreakers where user_id = p_user;
  delete from app.photos where user_id = p_user;
  delete from app.verifications where user_id = p_user;
  delete from app.honor_declarations where user_id = p_user;
  delete from app.member_profiles where user_id = p_user;
  update app.payments set user_id = null where user_id = p_user;
  update app.audit_log set actor_id = null where actor_id = p_user;
  update app.audit_log set target_id = null where target_id = p_user;
  update app.users set phone = null, deleted_at = now() where id = p_user;
  update app.account_deletions set purged_at = now() where user_id = p_user;
end $$;
revoke execute on function app.erase_account_data(uuid) from public, authenticated;

create or replace function app.purge_deleted_accounts() returns setof uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_user uuid;
begin
  perform app.require_permission('accounts.purge');
  for v_user in
    select user_id from app.account_deletions where purged_at is null and purge_after <= now() for update
  loop
    perform app.erase_account_data(v_user);
    return next v_user;
  end loop;
  -- Journal sans identifiant : seulement le nombre de comptes effacés
  if found then
    perform app.audit('accounts.purged', 'users', null,
                      jsonb_build_object('count', (select count(*) from app.account_deletions where purged_at >= now())));
  end if;
end $$;

create function app.admin_delete_account(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_role app.role;
  v_number text;
  v_status app.member_status;
  v_partner uuid;
begin
  if not app.has_permission('accounts.delete') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'self_action'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select role, member_number into v_role, v_number from app.users where id = p_user and deleted_at is null for update;
  if v_role is null then raise exception 'not_found'; end if;
  if v_role <> 'member' then raise exception 'staff_account'; end if;
  -- Soirée à venir : l'inscription est annulée d'abord (place et paiement suivent leurs règles)
  if exists (
       select 1 from app.event_registrations r join app.events e on e.id = r.event_id
        where r.user_id = p_user and r.status in ('booked', 'confirmed', 'checked_in')
          and e.status in ('published', 'full', 'in_progress') and e.starts_at > now())
     or exists (
       select 1 from app.waitlist_entries w join app.events e on e.id = w.event_id
        where w.user_id = p_user and e.status in ('published', 'full') and e.starts_at > now()) then
    raise exception 'upcoming_evening';
  end if;

  -- Découverte ou couple en cours : clôturé, l'autre membre est prévenu
  for v_partner in
    with closed as (
      update app.discoveries d set status = 'closed', closed_at = now()
        from app.matches m
       where m.id = d.match_id and p_user in (m.member_a, m.member_b) and d.status in ('active', 'extended')
      returning case when m.member_a = p_user then m.member_b else m.member_a end as partner
    )
    select partner from closed
  loop
    perform app.notify_with_deliveries(v_partner, 'discovery.partner_left', '{}'::jsonb);
  end loop;
  for v_partner in
    with closed as (
      update app.couples c set status = 'left', ended_at = now()
       where p_user in (c.member_a, c.member_b) and c.status in ('active', 'paused')
      returning case when c.member_a = p_user then c.member_b else c.member_a end as partner
    )
    select partner from closed
  loop
    perform app.notify_with_deliveries(v_partner, 'couple.partner_left', '{}'::jsonb);
  end loop;

  select status into v_status from app.member_profiles where user_id = p_user;
  insert into app.account_deletions (user_id, requested_at, purge_after, previous_status)
  values (p_user, now(), now(), coalesce(v_status, 'registering'))
  on conflict (user_id) do update
    set requested_at = excluded.requested_at, purge_after = excluded.purge_after,
        previous_status = excluded.previous_status, purged_at = null, cleaned_at = null;
  -- Effacement du téléphone : permis seulement sous ce drapeau de transaction (protect_user_columns)
  perform set_config('app.phone_change', 'on', true);
  perform app.erase_account_data(p_user);
  perform set_config('app.phone_change', '', true);

  -- Journal : motif et numéro de membre ; pas d'identifiant, comme pour les comptes effacés
  perform app.audit('account.deleted_by_admin', 'users', null,
                    jsonb_build_object('reason', btrim(p_reason), 'member_number', v_number));
end $$;
revoke execute on function app.admin_delete_account(uuid, text) from public;
grant execute on function app.admin_delete_account(uuid, text) to authenticated;
