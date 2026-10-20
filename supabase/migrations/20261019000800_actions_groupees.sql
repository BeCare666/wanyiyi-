-- Phase 2, étape 5 : actions groupées de la liste des membres (section 11.3).
-- Décisions du 19 octobre 2026 (question 24) :
--   - « Envoyer une notification » : message écrit par l'équipe en français, anglais et yoruba ;
--     chaque membre reçoit celui de sa langue, dans son espace, par SMS et par e-mail,
--     selon les canaux qu'il a choisis (une adresse e-mail confirmée est nécessaire).
--   - « Inviter à une soirée » : notification avec lien ; le membre réserve et paie lui-même.
--     Seuls les membres validés (qui peuvent réserver) sont invités.
-- Cible : une liste de membres cochés (200 au plus) ou tout le résultat d'un filtre (5 000 au plus).
-- La notification est créée tout de suite ; les envois SMS et e-mail passent par une file
-- vidée par l'API (tâche planifiée, Brevo). Chaque action est journalisée.

-- File d'envoi prévue par le schéma initial (status « queued » par défaut), complétée.
-- RLS active sans politique : ni les membres ni l'équipe n'y accèdent, seule l'API (service role).
alter table app.notification_deliveries
  add column attempts smallint not null default 0,
  add column last_error text,
  add column created_at timestamptz not null default now(),
  add constraint notification_deliveries_status check (status in ('queued', 'sent', 'failed')),
  add constraint notification_deliveries_channel check (channel in ('sms', 'email', 'whatsapp')),
  add constraint notification_deliveries_once unique (notification_id, channel);

-- ---------------------------------------------------------------------
-- 1. Membres visés : cochés, ou résultat d'un filtre (même filtre que la liste)
-- ---------------------------------------------------------------------
create function app.bulk_targets(p_targets uuid[], p_filter jsonb) returns setof uuid
language plpgsql stable security definer set search_path = app, public as $$
begin
  if (p_targets is null) = (p_filter is null) then raise exception 'invalid_targets'; end if;
  if p_targets is not null then
    if cardinality(p_targets) = 0 or cardinality(p_targets) > 200 then raise exception 'invalid_targets'; end if;
    return query select distinct u.id from app.users u where u.id = any(p_targets);
  else
    return query execute format('select x.user_id from (%s limit 5000) x', app.member_rows_sql(p_filter, null));
  end if;
end $$;

-- Notification et file d'envoi pour un membre, selon ses canaux (sans ligne : canal actif)
create function app.notify_with_deliveries(p_user uuid, p_kind text, p_payload jsonb) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_id uuid;
begin
  insert into app.notifications (user_id, kind, payload) values (p_user, p_kind, p_payload) returning id into v_id;
  insert into app.notification_deliveries (notification_id, channel)
  select v_id, c.channel
  from (values ('sms'::app.notification_channel), ('email'::app.notification_channel)) c(channel)
  where coalesce((select np.enabled from app.notification_preferences np where np.user_id = p_user and np.channel = c.channel), true);
end $$;

-- ---------------------------------------------------------------------
-- 2. Envoyer une notification (texte en trois langues)
-- ---------------------------------------------------------------------
create function app.admin_notify_members(p_targets uuid[], p_filter jsonb, p_body jsonb) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_body jsonb;
  v_user uuid;
  v_count integer := 0;
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_body is null or jsonb_typeof(p_body) <> 'object'
     or exists (
       select 1 from unnest(array['fr', 'en', 'yo']) l
       where jsonb_typeof(p_body->l) is distinct from 'string' or char_length(btrim(p_body->>l)) not between 1 and 500
     ) then
    raise exception 'invalid_message';
  end if;
  v_body := jsonb_build_object('fr', btrim(p_body->>'fr'), 'en', btrim(p_body->>'en'), 'yo', btrim(p_body->>'yo'));
  for v_user in select * from app.bulk_targets(p_targets, p_filter) loop
    perform app.notify_with_deliveries(v_user, 'team.message', jsonb_build_object('body', v_body));
    v_count := v_count + 1;
  end loop;
  perform app.audit('members.notified', 'notifications', null,
    jsonb_build_object('recipients', v_count, 'filter', p_filter, 'selected', cardinality(p_targets)));
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 3. Inviter à une soirée publiée à venir (membres validés seulement)
-- Renvoie le nombre d'invités et le nombre de membres écartés (non validés).
-- ---------------------------------------------------------------------
create function app.admin_invite_members(p_targets uuid[], p_filter jsonb, p_event uuid)
returns table (invited integer, skipped integer)
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_user uuid;
  v_invited integer := 0;
  v_skipped integer := 0;
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_event from app.events where id = p_event;
  if v_event.id is null then raise exception 'not_found'; end if;
  if v_event.status not in ('published', 'full') or v_event.starts_at <= now() then raise exception 'not_invitable'; end if;
  for v_user in select * from app.bulk_targets(p_targets, p_filter) loop
    if exists (select 1 from app.member_profiles p where p.user_id = v_user and p.status = 'verified') then
      perform app.notify_with_deliveries(v_user, 'evening.invitation', jsonb_build_object('event_id', p_event, 'starts_at', v_event.starts_at));
      v_invited := v_invited + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  perform app.audit('members.invited', 'events', p_event,
    jsonb_build_object('invited', v_invited, 'skipped', v_skipped, 'filter', p_filter, 'selected', cardinality(p_targets)));
  return query select v_invited, v_skipped;
end $$;

-- Soirées vers lesquelles inviter (sélecteur de l'action groupée)
create function app.invitable_events()
returns table (event_id uuid, starts_at timestamptz, venue_name text, status app.event_status)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select e.id, e.starts_at, v.name, e.status
    from app.events e left join app.venues v on v.id = e.venue_id
    where e.status in ('published', 'full') and e.starts_at > now()
    order by e.starts_at;
end $$;

-- ---------------------------------------------------------------------
-- 4. File d'envoi (tâche système de l'API, clé service role)
-- ---------------------------------------------------------------------
-- Envois en attente avec ce qu'il faut pour les écrire : langue, téléphone, e-mail confirmé.
-- Après 5 échecs, un envoi n'est plus retenté.
create function app.pending_deliveries(p_limit integer default 100)
returns table (
  delivery_id uuid,
  channel app.notification_channel,
  kind text,
  payload jsonb,
  locale app.locale,
  phone text,
  email text
)
language sql stable security definer set search_path = app, public as $$
  select d.id, d.channel, n.kind, n.payload, u.locale, u.phone,
         case when au.email_confirmed_at is not null then au.email end
  from app.notification_deliveries d
  join app.notifications n on n.id = d.notification_id
  join app.users u on u.id = n.user_id
  join auth.users au on au.id = u.id
  where d.status = 'queued' and d.attempts < 5
  order by d.created_at
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

-- Résultat d'un envoi : envoyé, ou échec (retenté jusqu'à 5 fois, puis abandonné).
-- p_skip : rien à envoyer (pas de téléphone, pas d'e-mail confirmé) : marqué en échec définitif.
create function app.mark_delivery(p_delivery uuid, p_ok boolean, p_error text default null, p_skip boolean default false) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  update app.notification_deliveries
     set attempts = attempts + 1,
         status = case when p_ok then 'sent' when p_skip or attempts + 1 >= 5 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         last_error = case when p_ok then null else left(p_error, 300) end
   where id = p_delivery;
  if not found then raise exception 'not_found'; end if;
end $$;

grant execute on function
  app.admin_notify_members(uuid[], jsonb, jsonb),
  app.admin_invite_members(uuid[], jsonb, uuid),
  app.invitable_events()
to authenticated, service_role;
grant execute on function app.pending_deliveries(integer), app.mark_delivery(uuid, boolean, text, boolean) to service_role;
