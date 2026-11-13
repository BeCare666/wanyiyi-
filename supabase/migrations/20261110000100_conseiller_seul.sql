-- Demande du 10/11/2026 : solliciter un conseiller SEUL (réponses de l'utilisateur au questionnaire) :
--   - tout membre vérifié, en couple ou non, sans l'accord de personne ;
--   - discussion privée : un éventuel partenaire n'est pas prévenu et ne lit rien ;
--   - l'administration attribue le conseiller (permission counselors.manage) ;
--   - les 3 premiers messages du membre sont gratuits, une seule fois dans sa vie de membre, puis
--     chaque message du membre coûte 200 FCFA (payé par FeexPay, message remis après paiement) ;
--     les réponses du conseiller sont gratuites ; prix et nombre gratuit réglables dans l'admin ;
--   - la demande à deux d'un couple (invitation, accord de l'autre, chat du couple) ne change pas.
-- La discussion reprend le canal privé membre-conseiller (kind 'counselor_private'), sans couple,
-- rattaché à la demande par conversations.counsel_request_id.

insert into app.settings (key, value) values ('counsel.message_price_xof', '200'), ('counsel.free_messages', '3')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table app.counsel_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references app.users (id) on delete cascade,
  counselor_id uuid references app.counselors (user_id),
  status text not null default 'requested' check (status in ('requested', 'granted', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  granted_at timestamptz,
  assigned_by uuid references app.users (id),
  closed_at timestamptz,
  closed_by uuid references app.users (id)
);
-- Une seule demande en cours par membre
create unique index counsel_requests_open_idx on app.counsel_requests (member_id) where status in ('requested', 'granted');
alter table app.counsel_requests enable row level security;
alter table app.counsel_requests force row level security;
create policy counsel_requests_select on app.counsel_requests for select using (member_id = auth.uid() or counselor_id = auth.uid());

-- Messages gratuits déjà utilisés : compteur durable (les messages sont effacés 90 jours après la fin)
create table app.counsel_usage (
  user_id uuid primary key references app.users (id) on delete cascade,
  free_used integer not null default 0 check (free_used >= 0)
);
alter table app.counsel_usage enable row level security;
alter table app.counsel_usage force row level security;

-- Message payant en attente de son paiement ; remis dans la discussion quand le paiement réussit
create table app.counsel_pending_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references app.counsel_requests (id) on delete cascade,
  conversation_id uuid not null references app.conversations (id) on delete cascade,
  member_id uuid not null references app.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  price_xof integer not null check (price_xof > 0),
  payment_id uuid references app.payments (id),
  message_id uuid references app.messages (id) on delete set null,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
alter table app.counsel_pending_messages enable row level security;
alter table app.counsel_pending_messages force row level security;

alter table app.conversations add column counsel_request_id uuid references app.counsel_requests (id);
alter table app.messages add column payment_id uuid references app.payments (id);

-- ---------------------------------------------------------------------
-- 2. Tarif et messages gratuits restants
-- ---------------------------------------------------------------------
create function app.counsel_free_left(p_user uuid) returns integer
language sql stable security definer set search_path = app, public as $$
  select greatest(0, app.setting_int('counsel.free_messages', 3) - coalesce((select u.free_used from app.counsel_usage u where u.user_id = p_user), 0))
$$;

-- Réglage par l'administration : prix de 0 à 100 000 FCFA (0 : tout est gratuit), 0 à 100 messages gratuits
create function app.admin_set_counsel_pricing(p_price_xof integer, p_free_messages integer) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_price_xof is null or p_price_xof < 0 or p_price_xof > 100000 then raise exception 'invalid_price'; end if;
  if p_free_messages is null or p_free_messages < 0 or p_free_messages > 100 then raise exception 'invalid_free_messages'; end if;
  insert into app.settings (key, value, updated_by, updated_at) values
    ('counsel.message_price_xof', to_jsonb(p_price_xof), auth.uid(), now()),
    ('counsel.free_messages', to_jsonb(p_free_messages), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform app.audit('counsel.pricing_set', 'settings', null, jsonb_build_object('price_xof', p_price_xof, 'free_messages', p_free_messages));
end $$;

create function app.counsel_pricing() returns table (price_xof integer, free_messages integer)
language sql stable security definer set search_path = app, public as $$
  select app.setting_int('counsel.message_price_xof', 200), app.setting_int('counsel.free_messages', 3)
$$;

-- ---------------------------------------------------------------------
-- 3. Demande du membre, seule
-- ---------------------------------------------------------------------
create function app.request_counsel() returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from app.member_profiles p where p.user_id = v_uid and p.status = 'verified') then raise exception 'not_validated'; end if;
  if exists (select 1 from app.counsel_requests r where r.member_id = v_uid and r.status in ('requested', 'granted')) then raise exception 'already_requested'; end if;
  insert into app.counsel_requests (member_id) values (v_uid) returning id into v_id;
  perform app.audit('counsel.requested', 'counsel_requests', v_id, '{}'::jsonb);
  return v_id;
end $$;

-- Annulation par le membre tant qu'aucun conseiller n'est attribué
create function app.cancel_counsel_request(p_request uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_request app.counsel_requests;
begin
  select * into v_request from app.counsel_requests where id = p_request for update;
  if not found or v_request.member_id is distinct from auth.uid() then raise exception 'not_found'; end if;
  if v_request.status <> 'requested' then raise exception 'not_pending'; end if;
  update app.counsel_requests set status = 'cancelled', closed_at = now(), closed_by = auth.uid() where id = p_request;
  perform app.audit('counsel.cancelled', 'counsel_requests', p_request, '{}'::jsonb);
end $$;

-- Fin de la discussion, par le membre ou par son conseiller : fermée, gardée 90 jours pour la modération
create function app.close_counsel(p_request uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_request app.counsel_requests;
begin
  select * into v_request from app.counsel_requests where id = p_request for update;
  if not found or auth.uid() is null or auth.uid() not in (v_request.member_id, coalesce(v_request.counselor_id, v_request.member_id)) then
    raise exception 'not_found';
  end if;
  if v_request.status <> 'granted' then raise exception 'not_pending'; end if;
  update app.counsel_requests set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_request;
  update app.conversations set closed_at = now(), read_only = true, delete_after = now() + interval '90 days'
   where counsel_request_id = p_request and closed_at is null;
  perform app.notify_with_deliveries(
    case when auth.uid() = v_request.member_id then v_request.counselor_id else v_request.member_id end,
    'counsel.closed', jsonb_build_object('request_id', p_request));
  perform app.audit('counsel.closed', 'counsel_requests', p_request, '{}'::jsonb);
end $$;

-- Demande en cours (ou la dernière) du membre connecté, avec sa discussion
create function app.my_counsel()
returns table (request_id uuid, status text, created_at timestamptz, granted_at timestamptz, counselor_name text,
               conversation_id uuid, price_xof integer, free_left integer)
language sql stable security definer set search_path = app, public as $$
  select r.id, r.status, r.created_at, r.granted_at, co.display_name,
         (select c.id from app.conversations c where c.counsel_request_id = r.id and c.closed_at is null limit 1),
         app.setting_int('counsel.message_price_xof', 200), app.counsel_free_left(auth.uid())
  from app.counsel_requests r
  left join app.counselors co on co.user_id = r.counselor_id
  where r.member_id = auth.uid() and r.status in ('requested', 'granted')
$$;

-- ---------------------------------------------------------------------
-- 4. Administration : demandes en attente, attribution
-- ---------------------------------------------------------------------
create function app.admin_counsel_requests()
returns table (request_id uuid, created_at timestamptz, first_name text, member_number text)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select r.id, r.created_at, p.first_name, u.member_number
    from app.counsel_requests r
    join app.users u on u.id = r.member_id
    left join app.member_profiles p on p.user_id = r.member_id
    where r.status = 'requested'
    order by r.created_at, r.id;
end $$;

create function app.admin_assign_counsel(p_request uuid, p_counselor uuid) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_request app.counsel_requests;
  v_counselor app.counselors;
  v_conversation uuid;
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_request from app.counsel_requests where id = p_request for update;
  if not found then raise exception 'not_found'; end if;
  if v_request.status <> 'requested' then raise exception 'not_pending'; end if;
  select * into v_counselor from app.counselors where user_id = p_counselor;
  if not found then raise exception 'not_found'; end if;
  if not v_counselor.is_available then raise exception 'counselor_unavailable'; end if;
  if p_counselor = v_request.member_id then raise exception 'invalid_counselor'; end if;
  update app.counsel_requests set counselor_id = p_counselor, status = 'granted', granted_at = now(), assigned_by = auth.uid() where id = p_request;
  insert into app.conversations (kind, member_id, counselor_id, counsel_request_id)
  values ('counselor_private', v_request.member_id, p_counselor, p_request) returning id into v_conversation;
  perform app.notify_with_deliveries(v_request.member_id, 'counsel.assigned', jsonb_build_object('request_id', p_request));
  perform app.notify_with_deliveries(p_counselor, 'counsel.granted', jsonb_build_object('request_id', p_request));
  perform app.audit('counsel.granted', 'counsel_requests', p_request, jsonb_build_object('counselor', p_counselor));
  return v_conversation;
end $$;

-- ---------------------------------------------------------------------
-- 5. Envoi : gratuit dans la limite, sinon paiement demandé
-- ---------------------------------------------------------------------
create or replace function app.send_message(p_conversation uuid, p_body text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_conversation app.conversations;
  v_body text := btrim(coalesce(p_body, ''));
  v_issues text[];
  v_id uuid;
begin
  select * into v_conversation from app.conversations where id = p_conversation;
  if not found or v_uid is null
     or not (app.conversation_member(p_conversation) or app.counselor_reads_since(p_conversation) is not null) then
    raise exception 'not_member';
  end if;
  if v_conversation.closed_at is not null or v_conversation.read_only then raise exception 'conversation_closed'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception 'invalid_body'; end if;
  v_issues := array(select i from unnest(app.text_contact_issues(v_body)) i where i in ('email', 'link', 'phone'));
  if cardinality(v_issues) > 0 then
    raise exception 'contact_blocked' using errcode = 'check_violation', detail = array_to_string(v_issues, ',');
  end if;
  -- Demande seule (10/11/2026) : message du membre gratuit dans la limite, sinon payant
  if v_conversation.counsel_request_id is not null and v_uid = v_conversation.member_id
     and app.setting_int('counsel.message_price_xof', 200) > 0 then
    insert into app.counsel_usage (user_id) values (v_uid) on conflict (user_id) do nothing;
    perform 1 from app.counsel_usage where user_id = v_uid for update;
    if app.counsel_free_left(v_uid) <= 0 then raise exception 'payment_required'; end if;
    update app.counsel_usage set free_used = free_used + 1 where user_id = v_uid;
  end if;
  insert into app.messages (conversation_id, sender_id, body) values (p_conversation, v_uid, v_body) returning id into v_id;
  if v_conversation.kind = 'couple' then
    update app.couples set last_activity_at = now() where id = v_conversation.couple_id;
  end if;
  return v_id;
end $$;

-- Message payant préparé (appelé avec le jeton du membre, par l'API) : mêmes contrôles que l'envoi
create function app.prepare_counsel_message(p_conversation uuid, p_body text) returns table (pending_id uuid, price_xof integer)
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_conversation app.conversations;
  v_body text := btrim(coalesce(p_body, ''));
  v_price integer := app.setting_int('counsel.message_price_xof', 200);
  v_id uuid;
begin
  select * into v_conversation from app.conversations where id = p_conversation;
  if not found or v_uid is null or v_conversation.counsel_request_id is null or v_conversation.member_id is distinct from v_uid
     or not app.conversation_member(p_conversation) then
    raise exception 'not_member';
  end if;
  if v_conversation.closed_at is not null or v_conversation.read_only then raise exception 'conversation_closed'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception 'invalid_body'; end if;
  if cardinality(array(select i from unnest(app.text_contact_issues(v_body)) i where i in ('email', 'link', 'phone'))) > 0 then
    raise exception 'contact_blocked' using errcode = 'check_violation';
  end if;
  if v_price <= 0 or app.counsel_free_left(v_uid) > 0 then raise exception 'nothing_to_pay'; end if;
  insert into app.counsel_pending_messages (request_id, conversation_id, member_id, body, price_xof)
  values (v_conversation.counsel_request_id, p_conversation, v_uid, v_body, v_price) returning id into v_id;
  return query select v_id, v_price;
end $$;

-- Paiement reçu : le message est remis dans la discussion (même fermée entre-temps : journalisé,
-- l'équipe rembourse à la main)
create function app.counsel_message_paid() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  v_pending app.counsel_pending_messages;
  v_closed boolean;
  v_message uuid;
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' and new.purpose = 'counsel_message' then
    select * into v_pending from app.counsel_pending_messages where payment_id = new.id and delivered_at is null for update;
    if found then
      select c.closed_at is not null into v_closed from app.conversations c where c.id = v_pending.conversation_id;
      insert into app.messages (conversation_id, sender_id, body, payment_id)
      values (v_pending.conversation_id, v_pending.member_id, v_pending.body, new.id) returning id into v_message;
      update app.counsel_pending_messages set delivered_at = now(), message_id = v_message where id = v_pending.id;
      perform app.audit(case when v_closed then 'counsel.message_paid_after_close' else 'counsel.message_paid' end,
        'counsel_pending_messages', v_pending.id, jsonb_build_object('payment_id', new.id));
    end if;
  end if;
  return new;
end $$;

create trigger payments_counsel_message after update of status on app.payments
  for each row execute function app.counsel_message_paid();

-- ---------------------------------------------------------------------
-- 6. Espace conseiller : canaux privés, en distinguant les demandes seules
-- ---------------------------------------------------------------------
drop function app.counselor_private_channels();
create function app.counselor_private_channels()
returns table (conversation_id uuid, couple_id uuid, member_first_name text, last_message_at timestamptz, unread integer, counsel_request_id uuid)
language sql stable security definer set search_path = app, public as $$
  select c.id, c.couple_id, p.first_name,
         (select max(m.created_at) from app.messages m where m.conversation_id = c.id),
         (select count(*)::integer from app.messages m
           where m.conversation_id = c.id and m.sender_id is distinct from auth.uid()
             and m.created_at > coalesce((select r.read_at from app.conversation_reads r where r.conversation_id = c.id and r.user_id = auth.uid()), '-infinity'::timestamptz)),
         c.counsel_request_id
  from app.conversations c
  left join app.member_profiles p on p.user_id = c.member_id
  where c.kind = 'counselor_private' and c.counselor_id = auth.uid() and c.closed_at is null
  order by 4 desc nulls last
$$;

revoke execute on function app.counsel_free_left(uuid) from public;
grant execute on function
  app.admin_set_counsel_pricing(integer, integer),
  app.counsel_pricing(),
  app.request_counsel(),
  app.cancel_counsel_request(uuid),
  app.close_counsel(uuid),
  app.my_counsel(),
  app.admin_counsel_requests(),
  app.admin_assign_counsel(uuid, uuid),
  app.prepare_counsel_message(uuid, text),
  app.counselor_private_channels()
to authenticated, service_role;
grant select on app.counsel_requests to authenticated;
grant select, insert, update on app.counsel_pending_messages to service_role;
