-- Phase 2, étape 5 : recherche globale de l'administration (section 11.1, en-tête).
--   - Une seule fonction, lue avec le jeton de la personne : chaque type de résultat n'apparaît
--     que si sa permission est accordée (membres, vérifications, soirées et lieux, paiements).
--   - Au moins 2 caractères ; au plus 5 résultats par type, les plus récents d'abord.
--   - Jamais de vote, de pièce d'identité ni de message dans les résultats.

create function app.admin_search(p_query text, p_per_kind integer default 5)
returns table (
  kind text,          -- member, verification, evening, venue, payment
  id uuid,
  title text,         -- nom, lieu ou référence (le site met en forme les dates)
  detail text,        -- numéro de membre, ville, état…
  at timestamptz
)
language plpgsql stable security definer set search_path = app, public as $$
declare
  v_query text := nullif(btrim(p_query), '');
  v_digits text;
  v_limit integer := greatest(1, least(coalesce(p_per_kind, 5), 20));
begin
  if not app.is_team() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_query is null or char_length(v_query) < 2 then return; end if;
  v_query := left(v_query, 100);
  v_digits := regexp_replace(v_query, '[^0-9]', '', 'g');

  if app.has_permission('members.manage') then
    return query
      select 'member', u.id, nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
             u.member_number, u.created_at
      from app.users u
      left join app.member_profiles p on p.user_id = u.id
      where p.first_name ilike '%' || v_query || '%'
         or p.last_name ilike '%' || v_query || '%'
         or (p.first_name || ' ' || p.last_name) ilike '%' || v_query || '%'
         or u.member_number ilike '%' || v_query || '%'
         or (char_length(v_digits) >= 4 and u.phone like '%' || v_digits || '%')
      order by u.created_at desc
      limit v_limit;
  end if;

  if app.has_permission('verifications.review') then
    return query
      select 'verification', v.id, nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
             v.status::text, v.created_at
      from app.verifications v
      join app.users u on u.id = v.user_id
      left join app.member_profiles p on p.user_id = v.user_id
      where p.first_name ilike '%' || v_query || '%'
         or p.last_name ilike '%' || v_query || '%'
         or (p.first_name || ' ' || p.last_name) ilike '%' || v_query || '%'
         or u.member_number ilike '%' || v_query || '%'
      order by v.created_at desc
      limit v_limit;
  end if;

  if app.has_permission('events.manage') then
    return query
      select 'evening', e.id, ve.name, e.status::text, e.starts_at
      from app.events e
      left join app.venues ve on ve.id = e.venue_id
      left join app.themes th on th.id = e.theme_id
      where ve.name ilike '%' || v_query || '%'
         or ve.city ilike '%' || v_query || '%'
         or th.key ilike '%' || v_query || '%'
      order by e.starts_at desc
      limit v_limit;
    return query
      select 'venue', ve.id, ve.name, ve.city, ve.created_at
      from app.venues ve
      where ve.name ilike '%' || v_query || '%'
         or ve.city ilike '%' || v_query || '%'
         or ve.address ilike '%' || v_query || '%'
      order by ve.name
      limit v_limit;
  end if;

  if app.has_permission('payments.read') then
    return query
      select 'payment', pa.id, pa.provider_transaction_id, pa.status::text, pa.created_at
      from app.payments pa
      left join app.users u on u.id = pa.user_id
      where pa.provider_transaction_id ilike '%' || v_query || '%'
         or u.member_number ilike '%' || v_query || '%'
      order by pa.created_at desc
      limit v_limit;
  end if;
end $$;

grant execute on function app.admin_search(text, integer) to authenticated, service_role;
