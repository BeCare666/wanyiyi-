-- =====================================================================
-- Wanyiyi : schéma initial complet (toutes phases)
-- Règle : Row Level Security activée sur TOUTES les tables.
-- Sans politique explicite, une table est inaccessible aux clients
-- (refus par défaut). Les politiques fines par rôle sont livrées avec
-- chaque module, accompagnées de leurs tests pgTAP.
-- Fuseau métier : Africa/Porto-Novo. Les dates sont stockées en timestamptz.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists app;

-- ---------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------
create type app.role as enum ('member', 'counselor', 'moderator', 'admin', 'super_admin');
create type app.sex as enum ('female', 'male');
create type app.locale as enum ('fr', 'en', 'yo');
create type app.member_status as enum ('registering', 'pending_verification', 'to_correct', 'verified', 'suspended', 'excluded', 'deleted');
create type app.journey_stage as enum ('registration', 'verification', 'evenings', 'discovery', 'couple', 'union_celebrated', 'cooldown');
create type app.verification_status as enum ('pending', 'to_correct', 'approved', 'rejected');
create type app.document_kind as enum ('id_card', 'passport', 'driving_licence', 'other');
create type app.review_status as enum ('pending', 'approved', 'rejected');
create type app.answer_side as enum ('self', 'seeking');
create type app.event_status as enum ('draft', 'published', 'full', 'in_progress', 'finished', 'cancelled');
create type app.registration_status as enum ('booked', 'confirmed', 'waitlisted', 'cancelled', 'released', 'checked_in', 'no_show');
create type app.vote_choice as enum ('yes', 'no');
create type app.match_status as enum ('pending_choice', 'discovery_open', 'expired', 'closed');
create type app.discovery_status as enum ('active', 'extended', 'continued', 'closed', 'expired');
create type app.couple_status as enum ('active', 'paused', 'union_celebrated', 'separated', 'left');
create type app.milestone_kind as enum ('first_dates', 'counselor_sessions', 'family_introduction', 'dowry_or_wedding', 'celebration');
create type app.conversation_kind as enum ('discovery', 'couple', 'counselor_private');
create type app.access_status as enum ('requested', 'granted', 'refused', 'revoked');
create type app.report_status as enum ('open', 'in_review', 'resolved', 'dismissed');
create type app.sanction_kind as enum ('warning', 'suspension', 'exclusion');
create type app.notification_channel as enum ('in_app', 'whatsapp', 'sms', 'email');
create type app.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded', 'cancelled');
create type app.payment_purpose as enum ('registration_fee', 'evening_booking', 'contribution');
create type app.payment_provider as enum ('fedapay', 'kkiapay');

-- ---------------------------------------------------------------------
-- Utilisateurs, rôles, profils
-- ---------------------------------------------------------------------

-- Une ligne par compte Supabase Auth
create table app.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role app.role not null default 'member',
  phone text unique,
  locale app.locale not null default 'fr',
  dark_mode boolean not null default false,
  member_number text unique, -- numéro affiché dans le filigrane
  consent_at timestamptz,     -- consentement explicite à l'inscription
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table app.role_permissions (
  role app.role not null,
  permission text not null,
  primary key (role, permission)
);

create table app.member_profiles (
  user_id uuid primary key references app.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,             -- jamais visible par les autres membres
  sex app.sex not null,
  birth_date date not null,
  city text,                           -- ville seulement, jamais d'adresse exacte
  status app.member_status not null default 'registering',
  journey_stage app.journey_stage not null default 'registration',
  evenings_blocked_until timestamptz,  -- retour aux soirées un mois après une séparation
  photo_blurred boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Textes libres : 3 zones d'environ 300 caractères, relues avant publication
create table app.profile_texts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  field text not null check (field in ('who_i_am', 'what_matters', 'evening_topic')),
  body text not null check (char_length(body) <= 300),
  review_status app.review_status not null default 'pending',
  reviewed_by uuid references app.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, field)
);

-- Réponses du profil, « Je me décris » (self) et « Ce que je recherche » (seeking)
create table app.profile_answers (
  user_id uuid not null references app.users (id) on delete cascade,
  side app.answer_side not null,
  category text not null,
  values text[] not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, side, category)
);

-- Au maximum 3 critères non négociables (contrôlé par déclencheur)
create table app.dealbreakers (
  user_id uuid not null references app.users (id) on delete cascade,
  category text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, category)
);

create table app.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  storage_path text not null,          -- compartiment privé « member-photos »
  position smallint not null default 0,
  review_status app.review_status not null default 'pending',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------
create table app.verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  status app.verification_status not null default 'pending',
  correction_note text,
  decided_by uuid references app.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.id_documents (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references app.verifications (id) on delete cascade,
  kind app.document_kind not null,
  storage_path text not null,          -- compartiment privé séparé « id-documents »
  uploaded_at timestamptz not null default now()
);

create table app.interviews (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references app.verifications (id) on delete cascade,
  scheduled_at timestamptz not null,
  interviewer_id uuid references app.users (id),
  report text,                         -- compte rendu, équipe uniquement
  completed_at timestamptz
);

create table app.honor_declarations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  declared_marital_status text not null,
  text_version text not null,
  signed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Soirées
-- ---------------------------------------------------------------------
create table app.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,               -- communiquée aux seuls participants confirmés
  city text not null default 'Cotonou',
  is_partner boolean not null default false,
  created_at timestamptz not null default now()
);

create table app.themes (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  min_age smallint,
  max_age smallint,
  required_religions text[],
  sectors text[],
  created_at timestamptz not null default now()
);

create table app.events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references app.venues (id),
  theme_id uuid references app.themes (id),
  starts_at timestamptz not null,
  capacity_women smallint not null default 10 check (capacity_women between 1 and 12),
  capacity_men smallint not null default 10 check (capacity_men between 1 and 12),
  round_minutes smallint not null default 7,
  changeover_minutes smallint not null default 1,
  price_xof integer check (price_xof >= 0),
  status app.event_status not null default 'draft',
  results_computed_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app.events (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  sex app.sex not null,                -- copié pour les quotas séparés
  status app.registration_status not null default 'booked',
  confirmed_at timestamptz,            -- confirmation obligatoire 48 h avant
  seat_number smallint,                -- table de départ
  payment_id uuid,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table app.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app.events (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  sex app.sex not null,
  position integer not null,
  offered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table app.event_tables (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app.events (id) on delete cascade,
  table_number smallint not null,
  qr_token text not null unique,       -- unique par soirée, valable pendant la soirée seulement
  qr_valid_from timestamptz not null,
  qr_valid_until timestamptz not null,
  unique (event_id, table_number)
);

create table app.rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app.events (id) on delete cascade,
  round_number smallint not null,
  is_break boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  unique (event_id, round_number)
);

-- Une rencontre : une femme et un homme à une table pendant un tour
create table app.round_pairings (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references app.rounds (id) on delete cascade,
  table_id uuid not null references app.event_tables (id) on delete cascade,
  woman_id uuid references app.users (id),
  man_id uuid references app.users (id),   -- null : tour de pause
  unique (round_id, table_id)
);

create table app.votes (
  id uuid primary key default gen_random_uuid(),
  pairing_id uuid not null references app.round_pairings (id) on delete cascade,
  voter_id uuid not null references app.users (id) on delete cascade,
  target_id uuid not null references app.users (id) on delete cascade,
  choice app.vote_choice not null,
  updated_at timestamptz not null default now(), -- modifiable jusqu'à la fin de la soirée
  unique (pairing_id, voter_id)
);

-- Appréciation facultative, visible uniquement par l'équipe
create table app.vote_feedback (
  vote_id uuid primary key references app.votes (id) on delete cascade,
  respect smallint check (respect between 1 and 5),
  punctuality smallint check (punctuality between 1 and 5),
  seriousness smallint check (seriousness between 1 and 5)
);

-- ---------------------------------------------------------------------
-- Matchs, découvertes, couples
-- ---------------------------------------------------------------------
create table app.matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app.events (id),
  member_a uuid not null references app.users (id),
  member_b uuid not null references app.users (id),
  status app.match_status not null default 'pending_choice',
  announced_at timestamptz,            -- le lendemain à 8 h
  pending_expires_at timestamptz,      -- 7 jours si au-delà de 2 découvertes actives
  created_at timestamptz not null default now(),
  check (member_a < member_b),
  unique (event_id, member_a, member_b)
);

create table app.discoveries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references app.matches (id),
  status app.discovery_status not null default 'active',
  opened_at timestamptz not null default now(),
  ends_at timestamptz not null,        -- 14 jours
  extended boolean not null default false, -- une seule prolongation de 7 jours
  closed_at timestamptz
);

create table app.discovery_decisions (
  discovery_id uuid not null references app.discoveries (id) on delete cascade,
  user_id uuid not null references app.users (id),
  wants_to_continue boolean not null default false,
  wants_extension boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (discovery_id, user_id)
);

create table app.couples (
  id uuid primary key default gen_random_uuid(),
  discovery_id uuid unique references app.discoveries (id),
  member_a uuid not null references app.users (id),
  member_b uuid not null references app.users (id),
  counselor_id uuid,
  status app.couple_status not null default 'active',
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  memory_space boolean not null default false, -- devient « Espace souvenir » après l'union
  keep_chat_after_union boolean not null default false,
  created_at timestamptz not null default now(),
  check (member_a < member_b)
);

create table app.couple_milestones (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references app.couples (id) on delete cascade,
  kind app.milestone_kind not null,
  reached_at timestamptz,
  note text,
  unique (couple_id, kind)
);

-- Rendez-vous déclarés et message « Bien rentré(e) ? »
create table app.date_checkins (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid references app.couples (id) on delete cascade,
  discovery_id uuid references app.discoveries (id) on delete cascade,
  declared_by uuid not null references app.users (id),
  date_at timestamptz not null,
  checkin_sent_at timestamptz,
  check (couple_id is not null or discovery_id is not null)
);

-- Partage des numéros : effectif seulement si les deux ont cliqué
create table app.phone_shares (
  couple_id uuid not null references app.couples (id) on delete cascade,
  user_id uuid not null references app.users (id),
  shared_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

-- ---------------------------------------------------------------------
-- Conseillers et conversations
-- ---------------------------------------------------------------------
create table app.counselors (
  user_id uuid primary key references app.users (id) on delete cascade,
  display_name text not null,
  bio text,
  languages app.locale[] not null default '{fr}',
  max_couples smallint not null default 20,
  is_available boolean not null default true
);

alter table app.couples
  add constraint couples_counselor_fk foreign key (counselor_id) references app.counselors (user_id);

create table app.counselor_availability (
  id uuid primary key default gen_random_uuid(),
  counselor_id uuid not null references app.counselors (user_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at)
);

create table app.conversations (
  id uuid primary key default gen_random_uuid(),
  kind app.conversation_kind not null,
  discovery_id uuid references app.discoveries (id),
  couple_id uuid references app.couples (id),
  counselor_id uuid references app.counselors (user_id), -- canal privé individuel
  member_id uuid references app.users (id),              -- canal privé individuel
  read_only boolean not null default false,
  closed_at timestamptz,
  delete_after timestamptz,            -- 90 jours après séparation, 12 mois après union
  created_at timestamptz not null default now()
);

create table app.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references app.conversations (id) on delete cascade,
  sender_id uuid references app.users (id), -- null : message système
  body text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on app.messages (conversation_id, created_at);

-- Accès du conseiller au chat du couple : demande, double acceptation, retrait
create table app.counselor_access (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references app.couples (id) on delete cascade,
  counselor_id uuid not null references app.counselors (user_id),
  requested_by uuid not null references app.users (id),
  status app.access_status not null default 'requested',
  include_history boolean not null default false, -- seulement si les deux le cochent
  granted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references app.users (id),
  created_at timestamptz not null default now()
);

create table app.counselor_access_consents (
  access_id uuid not null references app.counselor_access (id) on delete cascade,
  user_id uuid not null references app.users (id),
  accepted boolean not null,
  include_history boolean not null default false,
  decided_at timestamptz not null default now(),
  primary key (access_id, user_id)
);

create table app.sessions (
  id uuid primary key default gen_random_uuid(),
  counselor_id uuid not null references app.counselors (user_id),
  couple_id uuid references app.couples (id),
  member_id uuid references app.users (id),
  is_mediation boolean not null default false, -- médiation à trois
  scheduled_at timestamptz not null,
  location text,
  completed_at timestamptz
);

-- Notes privées : jamais visibles par les membres
create table app.counselor_notes (
  id uuid primary key default gen_random_uuid(),
  counselor_id uuid not null references app.counselors (user_id),
  couple_id uuid references app.couples (id),
  member_id uuid references app.users (id),
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Sécurité et modération
-- ---------------------------------------------------------------------
create table app.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references app.users (id),
  reported_user_id uuid references app.users (id),
  conversation_id uuid references app.conversations (id),
  reason text not null,
  status app.report_status not null default 'open',
  due_at timestamptz not null default now() + interval '24 hours',
  handled_by uuid references app.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Seuls les messages signalés sont accessibles à la modération
create table app.reported_messages (
  report_id uuid not null references app.reports (id) on delete cascade,
  message_id uuid not null references app.messages (id) on delete cascade,
  primary key (report_id, message_id)
);

create table app.sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id),
  kind app.sanction_kind not null,
  reason text not null,
  report_id uuid references app.reports (id),
  decided_by uuid not null references app.users (id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz
);

create table app.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references app.users (id),
  action text not null,                -- ex. id_document.viewed, reported_message.viewed, role.changed
  target_table text,
  target_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Notifications et paiements
-- ---------------------------------------------------------------------
create table app.notification_preferences (
  user_id uuid not null references app.users (id) on delete cascade,
  channel app.notification_channel not null,
  enabled boolean not null default true,
  primary key (user_id, channel)
);

create table app.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on app.notifications (user_id, created_at desc);

create table app.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references app.notifications (id) on delete cascade,
  channel app.notification_channel not null,
  provider_message_id text,
  status text not null default 'queued',
  sent_at timestamptz
);

create table app.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app.users (id),
  purpose app.payment_purpose not null,
  amount_xof integer not null check (amount_xof > 0),
  provider app.payment_provider not null default 'fedapay',
  provider_transaction_id text unique,
  status app.payment_status not null default 'pending',
  refunded_amount_xof integer not null default 0,
  reconciled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table app.event_registrations
  add constraint registrations_payment_fk foreign key (payment_id) references app.payments (id);

-- ---------------------------------------------------------------------
-- Phase 4 : prestataires, cagnottes, parrainage, badges
-- ---------------------------------------------------------------------
create table app.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  description text,
  image_public_id text,                -- Cloudinary (contenu public)
  contact text,
  is_active boolean not null default true
);

create table app.cagnottes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references app.couples (id),
  title text not null,
  goal_xof integer check (goal_xof > 0),
  public_token text unique,
  closes_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.contributions (
  id uuid primary key default gen_random_uuid(),
  cagnotte_id uuid not null references app.cagnottes (id),
  contributor_name text,
  message text,
  amount_xof integer not null check (amount_xof > 0),
  payment_id uuid references app.payments (id),
  created_at timestamptz not null default now()
);

-- Règles à définir (question ouverte n° 14)
create table app.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references app.users (id),
  referred_id uuid references app.users (id),
  code text not null unique,
  created_at timestamptz not null default now()
);

create table app.trust_badges (
  user_id uuid not null references app.users (id) on delete cascade,
  badge text not null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge)
);

-- ---------------------------------------------------------------------
-- Contenus, traductions, paramètres, filtres enregistrés
-- ---------------------------------------------------------------------
create table app.translations (
  locale app.locale not null,
  key text not null,
  value text not null,
  needs_review boolean not null default false,
  updated_by uuid references app.users (id),
  updated_at timestamptz not null default now(),
  primary key (locale, key)
);

create table app.testimonials (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid references app.couples (id),
  locale app.locale not null,
  quote text not null,
  signature text not null,
  authorized_at timestamptz,           -- affiché seulement si autorisé
  published boolean not null default false
);

create table app.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references app.users (id),
  updated_at timestamptz not null default now()
);

create table app.saved_filters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app.users (id),
  resource text not null,              -- members, events, payments...
  name text not null,
  definition jsonb not null,           -- arbre ET / OU imbriqué
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Fonctions d'aide pour les politiques RLS
-- ---------------------------------------------------------------------
create or replace function app.user_role() returns app.role
language sql stable security definer set search_path = app, public as $$
  select role from app.users where id = auth.uid() and deleted_at is null
$$;

create or replace function app.has_role(roles app.role[]) returns boolean
language sql stable security definer set search_path = app, public as $$
  select coalesce(app.user_role() = any (roles), false)
$$;

-- Au maximum 3 critères non négociables
create or replace function app.enforce_dealbreaker_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from app.dealbreakers where user_id = new.user_id) >= 3 then
    raise exception 'Au maximum 3 critères non négociables' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger dealbreakers_limit before insert on app.dealbreakers
  for each row execute function app.enforce_dealbreaker_limit();

-- ---------------------------------------------------------------------
-- Row Level Security : activée partout (refus par défaut)
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'app' loop
    execute format('alter table app.%I enable row level security', t.tablename);
    execute format('alter table app.%I force row level security', t.tablename);
  end loop;
end $$;

-- Premières politiques : chacun lit son propre compte et son propre profil.
create policy users_select_self on app.users for select using (id = auth.uid());
create policy member_profiles_select_self on app.member_profiles for select using (user_id = auth.uid());
create policy notifications_select_self on app.notifications for select using (user_id = auth.uid());
create policy notifications_update_self on app.notifications for update using (user_id = auth.uid());

-- Paramètres : lecture par l'équipe, écriture par l'administration
create policy settings_select_team on app.settings for select
  using (app.has_role(array['moderator', 'admin', 'super_admin']::app.role[]));
create policy settings_write_admin on app.settings for all
  using (app.has_role(array['admin', 'super_admin']::app.role[]))
  with check (app.has_role(array['admin', 'super_admin']::app.role[]));

-- Journal d'audit : lecture par la super administration uniquement, jamais de modification
create policy audit_select_super on app.audit_log for select
  using (app.has_role(array['super_admin']::app.role[]));

-- ---------------------------------------------------------------------
-- Valeurs par défaut des paramètres (section 9)
-- ---------------------------------------------------------------------
insert into app.settings (key, value) values
  ('evenings.default_capacity_per_sex', '10'),
  ('evenings.max_capacity_per_sex', '12'),
  ('evenings.max_per_week', '3'),
  ('evenings.confirmation_hours_before', '48'),
  ('evenings.round_minutes', '7'),
  ('evenings.changeover_minutes', '1'),
  ('votes.match_announcement_hour', '8'),
  ('discovery.duration_days', '14'),
  ('discovery.extension_days', '7'),
  ('discovery.max_active_per_member', '2'),
  ('discovery.pending_match_expiry_days', '7'),
  ('couple.inactivity_alert_days', '60'),
  ('couple.separation_chat_retention_days', '90'),
  ('couple.union_chat_retention_months', '12'),
  ('couple.return_after_separation_months', '1'),
  ('safety.signed_photo_url_seconds', '300'),
  ('safety.report_target_hours', '24');
