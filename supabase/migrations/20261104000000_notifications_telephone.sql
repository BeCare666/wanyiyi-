-- Notifications sur le téléphone (web push), décisions du 04/11/2026 :
--   1. toutes les notifications de l'espace membre partent aussi sur le téléphone ;
--   2. texte discret sur l'écran verrouillé (écrit par l'API, sans prénom ni détail) ;
--   3. le membre active lui-même les notifications, appareil par appareil (bouton) ;
--   4. envoi par l'API (bibliothèque web-push, clés VAPID), tâche système journalisée.
-- File d'envoi propre au téléphone (un envoi par appareil abonné), à côté de
-- notification_deliveries : le type app.notification_channel n'est pas modifié.

-- ---------------------------------------------------------------------
-- 1. Appareils abonnés
-- ---------------------------------------------------------------------
create table if not exists app.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 100),
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index if not exists push_subscriptions_user_idx on app.push_subscriptions (user_id);

alter table app.push_subscriptions enable row level security;
alter table app.push_subscriptions force row level security;
-- Le membre voit ses propres appareils ; l'écriture passe par les fonctions ci-dessous.
drop policy if exists push_subscriptions_select_self on app.push_subscriptions;
create policy push_subscriptions_select_self on app.push_subscriptions for select using (user_id = auth.uid());
revoke all on app.push_subscriptions from anon, authenticated;
grant select on app.push_subscriptions to authenticated;

-- Abonnement de l'appareil courant. Un même appareil (même endpoint) passe au membre connecté.
create or replace function app.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into app.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;

-- Désabonnement de l'appareil courant (seulement s'il appartient au membre).
create or replace function app.remove_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from app.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke execute on function app.save_push_subscription(text, text, text, text), app.remove_push_subscription(text) from public;
grant execute on function app.save_push_subscription(text, text, text, text), app.remove_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. File d'envoi : chaque nouvelle notification part sur chaque appareil abonné
-- ---------------------------------------------------------------------
create table if not exists app.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references app.notifications (id) on delete cascade,
  subscription_id uuid not null references app.push_subscriptions (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id, subscription_id)
);
create index if not exists push_deliveries_queued_idx on app.push_deliveries (created_at) where status = 'queued';
alter table app.push_deliveries enable row level security;
alter table app.push_deliveries force row level security;
revoke all on app.push_deliveries from anon, authenticated;

create or replace function app.queue_push_deliveries() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  insert into app.push_deliveries (notification_id, subscription_id)
  select new.id, s.id from app.push_subscriptions s where s.user_id = new.user_id
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists notifications_queue_push on app.notifications;
create trigger notifications_queue_push after insert on app.notifications
  for each row execute function app.queue_push_deliveries();

-- Envois en attente, avec la langue du membre (texte discret écrit par l'API).
-- Après 5 échecs, un envoi n'est plus retenté ; seuls les envois de moins de 24 h partent.
create or replace function app.pending_push_deliveries(p_limit integer default 100)
returns table (delivery_id uuid, subscription_id uuid, endpoint text, p256dh text, auth text, locale app.locale)
language sql stable security definer set search_path = app, public as $$
  select d.id, s.id, s.endpoint, s.p256dh, s.auth, u.locale
  from app.push_deliveries d
  join app.push_subscriptions s on s.id = d.subscription_id
  join app.users u on u.id = s.user_id
  where d.status = 'queued' and d.attempts < 5 and d.created_at > now() - interval '24 hours'
    and u.deleted_at is null
  order by d.created_at
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

-- Résultat d'un envoi. p_gone : l'appareil n'existe plus (réponse 404 ou 410), l'abonnement
-- est supprimé (avec ses envois en attente).
create or replace function app.mark_push_delivery(p_delivery uuid, p_ok boolean, p_error text default null, p_gone boolean default false)
returns void
language plpgsql security definer set search_path = app, public as $$
declare v_sub uuid;
begin
  update app.push_deliveries
     set attempts = attempts + 1,
         status = case when p_ok then 'sent' when attempts + 1 >= 5 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         last_error = case when p_ok then null else left(p_error, 300) end
   where id = p_delivery
  returning subscription_id into v_sub;
  if v_sub is null then raise exception 'not_found'; end if;
  if p_ok then
    update app.push_subscriptions set last_success_at = now() where id = v_sub;
  elsif p_gone then
    delete from app.push_subscriptions where id = v_sub;
  end if;
end $$;

-- Envois anciens supprimés (journal léger) : appelée par la tâche de l'API.
create or replace function app.purge_push_deliveries() returns integer
language plpgsql security definer set search_path = app, public as $$
declare v_count integer;
begin
  delete from app.push_deliveries where created_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function app.pending_push_deliveries(integer), app.mark_push_delivery(uuid, boolean, text, boolean), app.purge_push_deliveries() from public;
grant execute on function app.pending_push_deliveries(integer), app.mark_push_delivery(uuid, boolean, text, boolean), app.purge_push_deliveries() to service_role;

-- ---------------------------------------------------------------------
-- 3. Compte supprimé : plus aucun appareil abonné
-- ---------------------------------------------------------------------
create or replace function app.drop_push_subscriptions_on_delete() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from app.push_subscriptions where user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists users_drop_push_subscriptions on app.users;
create trigger users_drop_push_subscriptions after update of deleted_at on app.users
  for each row execute function app.drop_push_subscriptions_on_delete();
