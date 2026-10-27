-- Phase 3 : signalements (question 11, proposition validée le 27 octobre 2026 ; section 11.2-4).
--   a) « Signaler » sur chaque conversation (découverte, couple) et sur chaque message. Motifs :
--      comportement irrespectueux ou harcèlement ; demande d'argent ou arnaque ; faux profil ou
--      fausse identité ; propos ou contenu sexuel non souhaité ; menace ou danger ; autre (texte
--      libre obligatoire).
--   b) File « Signalements » de l'administration : administration et super administration
--      décident (reports.manage), la modération lit (reports.read). Délai cible de 24 heures.
--      Seuls les messages signalés sont lisibles, chaque consultation est journalisée. Un
--      signalement de conversation joint les 20 derniers messages de la personne signalée dans
--      cette conversation (jamais ceux de la personne qui signale).
--   c) La personne signalée n'est pas prévenue du signalement ; elle n'apprend que la décision
--      (avertissement, suspension, exclusion) avec un motif neutre écrit par l'équipe.
--   d) Pas de fermeture automatique, sauf « menace ou danger » : conversation en lecture seule
--      aussitôt, en attendant l'équipe.

insert into app.role_permissions (role, permission) values
  ('admin', 'reports.manage'), ('super_admin', 'reports.manage'),
  ('moderator', 'reports.read'), ('admin', 'reports.read'), ('super_admin', 'reports.read')
on conflict do nothing;

alter table app.reports
  add column reason_code text check (reason_code in ('disrespect', 'money', 'fake_profile', 'sexual', 'threat', 'other')),
  add column details text check (char_length(details) <= 1000),
  add column message_id uuid references app.messages (id) on delete set null,
  add column decision text check (decision in ('dismissed', 'warning', 'suspension', 'exclusion')),
  add column decision_reason text;

alter table app.reports enable row level security;
alter table app.reports force row level security;
-- La personne qui signale voit ses propres signalements ; la personne signalée ne voit rien
create policy reports_select_reporter on app.reports for select using (reporter_id = auth.uid());

-- ---------------------------------------------------------------------
-- 1. Signaler
-- ---------------------------------------------------------------------
create function app.report_conversation(p_conversation uuid, p_message uuid, p_reason text, p_details text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_conversation app.conversations;
  v_reported uuid;
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_id uuid;
begin
  if v_uid is null or not app.conversation_member(p_conversation) then raise exception 'not_member'; end if;
  select * into v_conversation from app.conversations where id = p_conversation;
  if v_conversation.kind not in ('discovery', 'couple') then raise exception 'not_member'; end if;
  if p_reason not in ('disrespect', 'money', 'fake_profile', 'sexual', 'threat', 'other') then raise exception 'invalid_reason'; end if;
  if p_reason = 'other' and v_details is null then raise exception 'details_required'; end if;
  if char_length(coalesce(v_details, '')) > 1000 then raise exception 'details_too_long'; end if;

  if p_message is not null then
    select m.sender_id into v_reported from app.messages m
     where m.id = p_message and m.conversation_id = p_conversation and not m.is_system;
    if v_reported is null or v_reported = v_uid then raise exception 'invalid_message'; end if;
  else
    -- Conversation : l'autre membre de la découverte ou du couple
    select case when v_uid = x.a then x.b else x.a end into v_reported
    from (
      select coalesce(m.member_a, c.member_a) as a, coalesce(m.member_b, c.member_b) as b
      from app.conversations cv
      left join app.discoveries d on d.id = cv.discovery_id
      left join app.matches m on m.id = d.match_id
      left join app.couples c on c.id = cv.couple_id
      where cv.id = p_conversation
    ) x;
  end if;

  insert into app.reports (reporter_id, reported_user_id, conversation_id, message_id, reason, reason_code, details)
  values (v_uid, v_reported, p_conversation, p_message, p_reason, p_reason, v_details)
  returning id into v_id;

  if p_message is not null then
    insert into app.reported_messages (report_id, message_id) values (v_id, p_message);
  else
    insert into app.reported_messages (report_id, message_id)
    select v_id, m.id from app.messages m
    where m.conversation_id = p_conversation and m.sender_id = v_reported and not m.is_system
    order by m.created_at desc limit 20;
  end if;

  -- Menace ou danger : conversation en lecture seule tout de suite
  if p_reason = 'threat' then
    update app.conversations set read_only = true where id = p_conversation;
  end if;

  for v_reported in select u.id from app.users u where u.role in ('admin', 'super_admin') loop
    perform app.notify_with_deliveries(v_reported, 'report.received', jsonb_build_object('report_id', v_id, 'reason', p_reason));
  end loop;
  perform app.audit('report.created', 'reports', v_id, jsonb_build_object('reason', p_reason));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. File de l'administration
-- ---------------------------------------------------------------------
create function app.admin_reports(p_open_only boolean default true)
returns table (id uuid, reason text, details text, status app.report_status, due_at timestamptz, created_at timestamptz,
               conversation_kind app.conversation_kind, reporter_first_name text, reporter_number text,
               reported_user_id uuid, reported_first_name text, reported_number text, reported_status app.member_status,
               messages integer, decision text, decision_reason text, resolved_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('reports.read') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select r.id, r.reason_code, r.details, r.status, r.due_at, r.created_at, cv.kind,
           pr.first_name, ur.member_number, r.reported_user_id, pd.first_name, ud.member_number, pd.status,
           (select count(*)::integer from app.reported_messages rm where rm.report_id = r.id),
           r.decision, r.decision_reason, r.resolved_at
    from app.reports r
    left join app.conversations cv on cv.id = r.conversation_id
    left join app.users ur on ur.id = r.reporter_id left join app.member_profiles pr on pr.user_id = r.reporter_id
    left join app.users ud on ud.id = r.reported_user_id left join app.member_profiles pd on pd.user_id = r.reported_user_id
    where not p_open_only or r.status in ('open', 'in_review')
    order by (r.status in ('open', 'in_review')) desc, r.due_at
    limit 200;
end $$;

-- Messages signalés seulement ; chaque consultation journalisée ; le signalement passe « en cours »
create function app.admin_reported_messages(p_report uuid)
returns table (id uuid, sender_first_name text, body text, created_at timestamptz)
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('reports.read') then raise exception 'forbidden' using errcode = '42501'; end if;
  update app.reports r set status = 'in_review', handled_by = coalesce(r.handled_by, auth.uid()) where r.id = p_report and r.status = 'open';
  perform app.audit('reported_message.viewed', 'reports', p_report, '{}'::jsonb);
  return query
    select m.id, p.first_name, m.body, m.created_at
    from app.reported_messages rm
    join app.messages m on m.id = rm.message_id
    left join app.member_profiles p on p.user_id = m.sender_id
    where rm.report_id = p_report
    order by m.created_at;
end $$;

-- Décision : classement, avertissement, suspension ou exclusion (motif neutre notifié à la personne
-- signalée, jamais l'existence du signalement ni l'identité de qui a signalé)
create function app.admin_resolve_report(p_report uuid, p_decision text, p_reason text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_report app.reports;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.has_permission('reports.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_report from app.reports where id = p_report for update;
  if not found then raise exception 'not_found'; end if;
  if v_report.status not in ('open', 'in_review') then raise exception 'already_resolved'; end if;
  if p_decision not in ('dismissed', 'warning', 'suspension', 'exclusion') then raise exception 'invalid_decision'; end if;
  if p_decision <> 'dismissed' and v_reason is null then raise exception 'reason_required'; end if;
  if char_length(coalesce(v_reason, '')) > 1000 then raise exception 'reason_too_long'; end if;

  if p_decision = 'warning' then
    insert into app.sanctions (user_id, kind, reason, decided_by, report_id) values (v_report.reported_user_id, 'warning', v_reason, auth.uid(), p_report);
    perform app.notify_with_deliveries(v_report.reported_user_id, 'member.warned', jsonb_build_object('reason', v_reason));
  elsif p_decision = 'suspension' then
    perform app.suspend_member(v_report.reported_user_id, v_reason);
    update app.sanctions set report_id = p_report where user_id = v_report.reported_user_id and kind = 'suspension' and ends_at is null and report_id is null;
  elsif p_decision = 'exclusion' then
    perform app.exclude_member(v_report.reported_user_id, v_reason);
    update app.sanctions set report_id = p_report where user_id = v_report.reported_user_id and kind = 'exclusion' and report_id is null;
  end if;

  update app.reports
     set status = case when p_decision = 'dismissed' then 'dismissed'::app.report_status else 'resolved'::app.report_status end,
         decision = p_decision, decision_reason = v_reason, handled_by = auth.uid(), resolved_at = now()
   where id = p_report;
  perform app.audit('report.' || p_decision, 'reports', p_report, jsonb_build_object('reason', v_reason));
end $$;

grant execute on function
  app.report_conversation(uuid, uuid, text, text),
  app.admin_reports(boolean),
  app.admin_reported_messages(uuid),
  app.admin_resolve_report(uuid, text, text)
to authenticated, service_role;
