-- Paramètres du membre (section 6.2-9 ; questions 15 à 17, réponses du 24 octobre 2026).
--   - Confidentialité : photo cachée jusqu'à un match réciproque (colonne photo_blurred du schéma
--     initial, vraie par défaut) ; numéro partagé après un match (nouvelle colonne share_phone,
--     vraie par défaut). Le membre modifie ces deux colonnes sur sa propre ligne (RLS).
--   - Mes données : app.my_data() rend en JSON le profil, les soirées, les votes donnés, les matchs
--     annoncés, les paiements et les notifications du membre (téléchargement immédiat, et page
--     imprimable en PDF par le navigateur).
--   - Suppression du compte : délai de 30 jours. Le compte est masqué tout de suite (état
--     « deleted »), le membre peut annuler pendant le délai (état précédent rendu). Demande refusée
--     tant qu'une soirée à venir n'est pas annulée par le membre. Une découverte ou un couple en
--     cours est clôturé et l'autre membre est prévenu. Au bout des 30 jours : profil, selfie,
--     textes, votes et notifications effacés ; paiements et journal d'audit gardés sans nom. Les
--     fichiers du selfie et le compte Supabase Auth sont effacés ensuite par l'API.

alter table app.member_profiles add column share_phone boolean not null default true;

insert into app.settings (key, value) values ('accounts.deletion_days', '30')
on conflict (key) do nothing;

create table app.account_deletions (
  user_id uuid primary key references app.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null,
  previous_status app.member_status not null,
  purged_at timestamptz,          -- données effacées en base
  cleaned_at timestamptz          -- fichiers et compte Supabase Auth effacés par l'API
);

alter table app.account_deletions enable row level security;
alter table app.account_deletions force row level security;
create policy account_deletions_select_self on app.account_deletions for select using (user_id = auth.uid());
create policy account_deletions_select_team on app.account_deletions for select using (app.is_team());
grant select on app.account_deletions to authenticated;

-- L'état « deleted » n'est posé et retiré par le membre que par les fonctions ci-dessous
create or replace function app.protect_profile_columns() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_client() or app.is_team() then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'registering';
    new.journey_stage := 'registration';
    new.evenings_blocked_until := null;
  elsif (new.status is distinct from old.status
         and not (old.status in ('registering', 'to_correct') and new.status = 'pending_verification'
                  and app.dossier_complete(new.user_id))
         and coalesce(current_setting('app.account_deletion', true), '') <> 'on')
     or new.journey_stage is distinct from old.journey_stage
     or new.evenings_blocked_until is distinct from old.evenings_blocked_until
     or new.sex is distinct from old.sex
     or new.birth_date is distinct from old.birth_date then
    -- Sexe et date de naissance sont vérifiés sur la pièce d'identité : modifiables par l'équipe seulement
    raise exception 'forbidden_column' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Mes données (question 16)
-- ---------------------------------------------------------------------
create function app.my_data() returns jsonb
language sql stable security definer set search_path = app, public as $$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (
      select jsonb_build_object('member_number', u.member_number, 'email', a.email, 'phone', u.phone,
                                'locale', u.locale, 'dark_mode', u.dark_mode, 'created_at', u.created_at)
      from app.users u left join auth.users a on a.id = u.id where u.id = auth.uid()),
    'profile', (
      select jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'sex', p.sex,
                                'birth_date', p.birth_date, 'city', p.city, 'status', p.status,
                                'journey_stage', p.journey_stage, 'photo_hidden_until_match', p.photo_blurred,
                                'share_phone_after_match', p.share_phone, 'created_at', p.created_at)
      from app.member_profiles p where p.user_id = auth.uid()),
    'texts', coalesce((
      select jsonb_agg(jsonb_build_object('field', t.field, 'body', t.body, 'review_status', t.review_status,
                                          'review_note', t.review_note, 'created_at', t.created_at) order by t.field)
      from app.profile_texts t where t.user_id = auth.uid()), '[]'),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('side', a.side, 'category', a.category, 'values', a."values") order by a.side, a.category)
      from app.profile_answers a where a.user_id = auth.uid()), '[]'),
    'dealbreakers', coalesce((
      select jsonb_agg(d.category order by d.category) from app.dealbreakers d where d.user_id = auth.uid()), '[]'),
    'verification', coalesce((
      select jsonb_agg(jsonb_build_object('status', v.status, 'created_at', v.created_at, 'decided_at', v.decided_at) order by v.created_at)
      from app.verifications v where v.user_id = auth.uid()), '[]'),
    'honor_declarations', coalesce((
      select jsonb_agg(jsonb_build_object('marital_status', h.declared_marital_status, 'text_version', h.text_version,
                                          'signed_at', h.signed_at) order by h.signed_at)
      from app.honor_declarations h where h.user_id = auth.uid()), '[]'),
    'evenings', coalesce((
      select jsonb_agg(x.item order by x.starts_at)
      from (
        select e.starts_at, jsonb_build_object('starts_at', e.starts_at, 'venue', v.name, 'city', v.city,
                                               'status', r.status, 'booked_at', r.created_at,
                                               'confirmed_at', r.confirmed_at, 'checked_in_at', r.checked_in_at) as item
        from app.event_registrations r
        join app.events e on e.id = r.event_id
        left join app.venues v on v.id = e.venue_id
        where r.user_id = auth.uid()
        union all
        select e.starts_at, jsonb_build_object('starts_at', e.starts_at, 'venue', v.name, 'city', v.city,
                                               'status', 'waitlisted', 'booked_at', w.created_at)
        from app.waitlist_entries w
        join app.events e on e.id = w.event_id
        left join app.venues v on v.id = e.venue_id
        where w.user_id = auth.uid()
      ) x), '[]'),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object('evening', e.starts_at, 'round', ro.round_number,
                                          'partner_first_name', tp.first_name, 'choice', vo.choice,
                                          'updated_at', vo.updated_at) order by e.starts_at, ro.round_number)
      from app.votes vo
      join app.round_pairings rp on rp.id = vo.pairing_id
      join app.rounds ro on ro.id = rp.round_id
      join app.events e on e.id = ro.event_id
      left join app.member_profiles tp on tp.user_id = vo.target_id
      where vo.voter_id = auth.uid()), '[]'),
    -- Matchs annoncés seulement (avant 8 h le lendemain, ils ne sont pas encore connus du membre)
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object('evening', e.starts_at, 'partner_first_name', pp.first_name,
                                          'status', m.status, 'announced_at', m.announced_at) order by m.announced_at)
      from app.matches m
      join app.events e on e.id = m.event_id
      left join app.member_profiles pp
        on pp.user_id = case when m.member_a = auth.uid() then m.member_b else m.member_a end
      where auth.uid() in (m.member_a, m.member_b) and m.announced_at <= now()), '[]'),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', p.purpose, 'amount_xof', p.amount_xof, 'provider', p.provider,
                                          'status', p.status, 'refunded_amount_xof', p.refunded_amount_xof,
                                          'created_at', p.created_at) order by p.created_at)
      from app.payments p where p.user_id = auth.uid()), '[]'),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object('kind', n.kind, 'payload', n.payload, 'created_at', n.created_at,
                                          'read_at', n.read_at) order by n.created_at)
      from app.notifications n where n.user_id = auth.uid()), '[]'),
    'notification_preferences', coalesce((
      select jsonb_agg(jsonb_build_object('channel', np.channel, 'enabled', np.enabled) order by np.channel)
      from app.notification_preferences np where np.user_id = auth.uid()), '[]'),
    'deletion', (
      select jsonb_build_object('requested_at', d.requested_at, 'purge_after', d.purge_after)
      from app.account_deletions d where d.user_id = auth.uid() and d.purged_at is null)
  )
  where auth.uid() is not null
$$;

revoke execute on function app.my_data() from public;
grant execute on function app.my_data() to authenticated;

-- ---------------------------------------------------------------------
-- Suppression du compte (question 17)
-- ---------------------------------------------------------------------
create function app.request_account_deletion() returns timestamptz
language plpgsql security definer set search_path = app, public as $$
declare
  v_user uuid := auth.uid();
  v_profile app.member_profiles;
  v_purge timestamptz;
  v_partner uuid;
begin
  select * into v_profile from app.member_profiles where user_id = v_user for update;
  if v_profile.user_id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_profile.status = 'deleted' then raise exception 'already_requested'; end if;
  -- Soirée à venir : le membre l'annule d'abord lui-même
  if exists (
       select 1 from app.event_registrations r join app.events e on e.id = r.event_id
        where r.user_id = v_user and r.status in ('booked', 'confirmed', 'checked_in')
          and e.status in ('published', 'full', 'in_progress') and e.starts_at > now())
     or exists (
       select 1 from app.waitlist_entries w join app.events e on e.id = w.event_id
        where w.user_id = v_user and e.status in ('published', 'full') and e.starts_at > now()) then
    raise exception 'upcoming_evening';
  end if;

  v_purge := now() + make_interval(days => app.setting_int('accounts.deletion_days', 30));
  insert into app.account_deletions (user_id, requested_at, purge_after, previous_status)
  values (v_user, now(), v_purge, v_profile.status)
  on conflict (user_id) do update
    set requested_at = excluded.requested_at, purge_after = excluded.purge_after,
        previous_status = excluded.previous_status, purged_at = null, cleaned_at = null;

  perform set_config('app.account_deletion', 'on', true);
  update app.member_profiles set status = 'deleted' where user_id = v_user;
  perform set_config('app.account_deletion', '', true);

  -- Découverte ou couple en cours : clôturé, l'autre membre est prévenu
  for v_partner in
    with closed as (
      update app.discoveries d set status = 'closed', closed_at = now()
        from app.matches m
       where m.id = d.match_id and v_user in (m.member_a, m.member_b) and d.status in ('active', 'extended')
      returning case when m.member_a = v_user then m.member_b else m.member_a end as partner
    )
    select partner from closed
  loop
    perform app.notify_with_deliveries(v_partner, 'discovery.partner_left', '{}'::jsonb);
  end loop;
  for v_partner in
    with closed as (
      update app.couples c set status = 'left', ended_at = now()
       where v_user in (c.member_a, c.member_b) and c.status in ('active', 'paused')
      returning case when c.member_a = v_user then c.member_b else c.member_a end as partner
    )
    select partner from closed
  loop
    perform app.notify_with_deliveries(v_partner, 'couple.partner_left', '{}'::jsonb);
  end loop;

  perform app.audit('account.deletion_requested', 'users', v_user, jsonb_build_object('purge_after', v_purge));
  return v_purge;
end $$;

create function app.cancel_account_deletion() returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_user uuid := auth.uid();
  v_request app.account_deletions;
begin
  select * into v_request from app.account_deletions where user_id = v_user and purged_at is null for update;
  if v_request.user_id is null or v_request.purge_after <= now() then raise exception 'no_request'; end if;
  perform set_config('app.account_deletion', 'on', true);
  update app.member_profiles set status = v_request.previous_status where user_id = v_user and status = 'deleted';
  perform set_config('app.account_deletion', '', true);
  delete from app.account_deletions where user_id = v_user;
  perform app.audit('account.deletion_cancelled', 'users', v_user, '{}'::jsonb);
end $$;

-- Tâche planifiée (clé service role) : comptes dont le délai est passé. Profil, selfie (lignes),
-- textes, réponses, votes et notifications effacés ; paiements et journal d'audit gardés sans nom.
-- Rend les comptes effacés, pour que l'API efface ensuite les fichiers et le compte Auth.
create function app.purge_deleted_accounts() returns setof uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_user uuid;
begin
  perform app.require_permission('accounts.purge');
  for v_user in
    select user_id from app.account_deletions where purged_at is null and purge_after <= now() for update
  loop
    delete from app.votes where voter_id = v_user;
    delete from app.notifications where user_id = v_user;
    delete from app.notification_preferences where user_id = v_user;
    delete from app.profile_texts where user_id = v_user;
    delete from app.profile_answers where user_id = v_user;
    delete from app.dealbreakers where user_id = v_user;
    delete from app.photos where user_id = v_user;
    delete from app.verifications where user_id = v_user;
    delete from app.honor_declarations where user_id = v_user;
    delete from app.member_profiles where user_id = v_user;
    update app.payments set user_id = null where user_id = v_user;
    update app.audit_log set actor_id = null where actor_id = v_user;
    update app.audit_log set target_id = null where target_id = v_user;
    update app.users set phone = null, deleted_at = now() where id = v_user;
    update app.account_deletions set purged_at = now() where user_id = v_user;
    return next v_user;
  end loop;
  -- Journal sans identifiant : seulement le nombre de comptes effacés
  if found then
    perform app.audit('accounts.purged', 'users', null,
                      jsonb_build_object('count', (select count(*) from app.account_deletions where purged_at >= now())));
  end if;
end $$;

-- Comptes effacés en base dont les fichiers et le compte Auth restent à effacer par l'API
create function app.accounts_to_clean() returns setof uuid
language sql stable security definer set search_path = app, public as $$
  select user_id from app.account_deletions where purged_at is not null and cleaned_at is null
$$;

create function app.mark_account_cleaned(p_user uuid) returns void
language sql security definer set search_path = app, public as $$
  update app.account_deletions set cleaned_at = now() where user_id = p_user and purged_at is not null
$$;

revoke execute on function app.request_account_deletion(), app.cancel_account_deletion() from public;
grant execute on function app.request_account_deletion(), app.cancel_account_deletion() to authenticated;
revoke execute on function app.purge_deleted_accounts(), app.accounts_to_clean(), app.mark_account_cleaned(uuid)
  from public, authenticated;
grant execute on function app.purge_deleted_accounts(), app.accounts_to_clean(), app.mark_account_cleaned(uuid)
  to service_role;
