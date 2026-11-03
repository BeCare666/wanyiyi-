-- Annonce des matchs à la fermeture de la soirée par l'équipe (demande du 03/11/2026),
-- et non plus le lendemain à 8 h. « Terminer la soirée » fige les votes, calcule les matchs
-- et les annonce aussitôt (notification, choix d'office, ouverture des découvertes).

create or replace function app.compute_matches(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_count integer;
begin
  perform app.require_permission('events.manage');
  select * into v_event from app.events where id = p_event for update;
  if v_event.status <> 'finished' then raise exception 'evening_not_finished'; end if;
  insert into app.matches (event_id, member_a, member_b, announced_at)
  select distinct p_event, least(a.voter_id, a.target_id), greatest(a.voter_id, a.target_id), now()
  from app.votes a
  join app.round_pairings pa on pa.id = a.pairing_id
  join app.rounds ra on ra.id = pa.round_id and ra.event_id = p_event
  join app.votes b on b.voter_id = a.target_id and b.target_id = a.voter_id and b.pairing_id = a.pairing_id
  where a.choice = 'yes' and b.choice = 'yes'
  on conflict (event_id, member_a, member_b) do nothing;
  get diagnostics v_count = row_count;
  update app.events set results_computed_at = now() where id = p_event;
  -- Matchs déjà calculés pour plus tard (ancienne règle) : annoncés maintenant aussi
  update app.matches set announced_at = now() where event_id = p_event and notified_at is null and announced_at > now();
  perform app.announce_matches();
  return v_count;
end $$;

create or replace function app.finish_evening(p_event uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_permission('events.manage');
  update app.events set status = 'finished' where id = p_event and status = 'in_progress';
  if not found then raise exception 'invalid_status'; end if;
  update app.event_tables set qr_valid_until = least(qr_valid_until, now()) where event_id = p_event;
  perform app.compute_matches(p_event);
end $$;

-- Date d'annonce affichée à l'équipe : celle des matchs, sinon celle du calcul (null avant la fin)
create or replace function app.event_results(p_event uuid)
returns table (checked_in integer, voters integer, matches integer, announced_at timestamptz, results_computed_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('events.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select (select count(*)::integer from app.event_registrations r where r.event_id = e.id and r.status = 'checked_in'),
           (select count(distinct vo.voter_id)::integer from app.votes vo
              join app.round_pairings pa on pa.id = vo.pairing_id
              join app.rounds ro on ro.id = pa.round_id where ro.event_id = e.id),
           (select count(*)::integer from app.matches m where m.event_id = e.id),
           coalesce((select min(m.announced_at) from app.matches m where m.event_id = e.id), e.results_computed_at),
           e.results_computed_at
    from app.events e where e.id = p_event;
end $$;
