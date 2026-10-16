-- Phase 2, étape 4 : page de vote ouverte par le code QR (section 6.2-5).
-- La page doit connaître les tours du membre pour qu'il choisisse celui sur lequel il vote.
-- Aucun prénom n'est renvoyé ici : il ne s'affiche que pour le tour choisi (app.round_partner).

create function app.my_evening_rounds(p_qr_token text)
returns table (round_number smallint, is_pause boolean, my_choice app.vote_choice)
language plpgsql stable security definer set search_path = app, public as $$
declare v_table app.event_tables;
begin
  -- Même contrôle que app.voting_pairing : code valable et soirée en cours
  select * into v_table from app.event_tables where qr_token = p_qr_token;
  if v_table is null
     or now() < v_table.qr_valid_from or now() > v_table.qr_valid_until
     or not exists (select 1 from app.events e where e.id = v_table.event_id and e.status = 'in_progress') then
    raise exception 'outside_evening';
  end if;
  return query
    select r.round_number,
           (case when p.woman_id = auth.uid() then p.man_id else p.woman_id end) is null,
           v.choice
    from app.rounds r
    join app.round_pairings p on p.round_id = r.id and auth.uid() in (p.woman_id, p.man_id)
    left join app.votes v on v.pairing_id = p.id and v.voter_id = auth.uid()
    where r.event_id = v_table.event_id
    order by r.round_number;
  if not found then raise exception 'not_in_round'; end if;
end $$;

grant execute on function app.my_evening_rounds(text) to authenticated;
