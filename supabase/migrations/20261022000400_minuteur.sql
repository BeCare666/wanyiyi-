-- Minuteur de soirée sur tablette (note : « un minuteur administrateur sur tablette pilote les
-- tours, signal visuel et sonore » ; question 8, réponse du 22 octobre 2026 : pas de pause).
-- L'équipe démarre le minuteur une fois la soirée commencée : l'horaire de chaque tour est
-- enregistré (durée des tours et des changements de table réglée sur la soirée), les tours
-- s'enchaînent sans pause. Démarrage unique, journalisé. Permission events.manage.

create function app.start_timer(p_event uuid) returns timestamptz
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_start timestamptz := now();
begin
  perform app.require_permission('events.manage');
  select * into v_event from app.events where id = p_event for update;
  if v_event.id is null then raise exception 'not_found'; end if;
  if v_event.status <> 'in_progress' then raise exception 'invalid_status'; end if;
  if not exists (select 1 from app.rounds where event_id = p_event) then raise exception 'not_prepared'; end if;
  if exists (select 1 from app.rounds where event_id = p_event and started_at is not null) then raise exception 'already_started'; end if;
  update app.rounds
     set started_at = v_start + make_interval(mins => (round_number - 1) * (v_event.round_minutes + v_event.changeover_minutes)),
         ended_at = v_start + make_interval(mins => (round_number - 1) * (v_event.round_minutes + v_event.changeover_minutes) + v_event.round_minutes)
   where event_id = p_event;
  perform app.audit('evening.timer_started', 'events', p_event, '{}'::jsonb);
  return v_start;
end $$;

-- Horaire des tours pour la tablette
create function app.evening_timer(p_event uuid)
returns table (round_number smallint, started_at timestamptz, ended_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('events.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select r.round_number, r.started_at, r.ended_at from app.rounds r where r.event_id = p_event order by r.round_number;
end $$;

revoke execute on function app.start_timer(uuid), app.evening_timer(uuid) from public;
grant execute on function app.start_timer(uuid), app.evening_timer(uuid) to authenticated;
