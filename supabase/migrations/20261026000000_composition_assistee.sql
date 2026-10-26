-- Composition assistée d'une soirée (section 11.2-5 de la note : « alerte si deux participants ont des
-- critères non négociables incompatibles »). Chaque femme rencontre chaque homme de la soirée
-- (rotation complète) : pour chaque paire, et dans chaque sens, un critère non négociable de l'un
-- (recherche précise, sans « Indifférent ») est comparé à ce que l'autre a déclaré dans
-- « Je me décris » sur la même catégorie :
--   - « incompatible » : la réponse déclarée n'est pas dans la recherche ;
--   - « inconnu » : l'autre n'a pas répondu à cette catégorie (à vérifier par l'équipe).
-- Une réponse « Indifférent » de l'autre (lieu de vie souhaité) est compatible avec toute recherche.
-- Participants : places réservées, confirmées ou pointées (pas la liste d'attente).
-- Lecture réservée à la permission events.manage ; la décision reste à l'équipe.

create function app.event_composition_alerts(p_event uuid)
returns table (
  holder_id uuid,
  holder_number text,
  holder_first_name text,
  holder_sex app.sex,
  other_id uuid,
  other_number text,
  other_first_name text,
  category text,
  sought text[],
  declared text[],
  kind text
)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('events.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    with people as (
      select r.user_id, r.sex
      from app.event_registrations r
      where r.event_id = p_event and r.status in ('booked', 'confirmed', 'checked_in')
    )
    select h.user_id, uh.member_number, ph.first_name, h.sex,
           o.user_id, uo.member_number, po.first_name,
           d.category, s."values", a."values",
           case when a."values" is null then 'unknown' else 'incompatible' end
    from people h
    join app.dealbreakers d on d.user_id = h.user_id
    join app.profile_answers s on s.user_id = h.user_id and s.side = 'seeking' and s.category = d.category
    join people o on o.sex <> h.sex
    left join app.profile_answers a on a.user_id = o.user_id and a.side = 'self' and a.category = d.category
    join app.users uh on uh.id = h.user_id
    join app.users uo on uo.id = o.user_id
    left join app.member_profiles ph on ph.user_id = h.user_id
    left join app.member_profiles po on po.user_id = o.user_id
    where not ('indifferent' = any (s."values"))
      and (a."values" is null or not (a."values" && s."values" or 'indifferent' = any (a."values")))
    order by 11, 3, 7, 8;
end $$;

revoke execute on function app.event_composition_alerts(uuid) from public;
grant execute on function app.event_composition_alerts(uuid) to authenticated, service_role;
