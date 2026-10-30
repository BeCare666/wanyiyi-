-- Fiche d'une soirée (décision du 30 octobre 2026) : sous chaque inscrit, « Payée » ou
-- « Non payée, à payer avant le … », et en haut le nombre de places payées et le montant encaissé.
-- app.event_participants reprend la version de 20261019000000_admin_soirees.sql avec trois
-- colonnes en plus (le type de retour change : la fonction est recréée) :
--   - paid : paiement réussi rattaché à l'inscription (même règle que app.my_bookings) ;
--   - paid_xof : montant encaissé (montant moins la part remboursée), 0 sans paiement réussi ;
--   - pay_by : limite de paiement d'une place gardée non payée (même calcul que app.my_bookings).

drop function if exists app.event_participants(uuid);

create function app.event_participants(p_event uuid)
returns table (
  user_id uuid,
  member_number text,
  first_name text,
  last_name text,
  sex app.sex,
  status app.registration_status,
  waitlist_position integer,
  registered_at timestamptz,
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  seat_number smallint,
  paid boolean,
  paid_xof integer,
  pay_by timestamptz
)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('events.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select r.user_id, u.member_number, p.first_name, p.last_name, r.sex, r.status, null::integer,
           coalesce(r.seated_at, r.created_at), r.confirmed_at, r.checked_in_at, r.seat_number,
           pay.id is not null,
           coalesce(pay.amount_xof - pay.refunded_amount_xof, 0),
           case when r.status in ('booked', 'confirmed') and pay.id is null and e.price_xof is not null
                then least(coalesce(r.seated_at, r.created_at) + make_interval(hours => app.setting_int('evenings.unpaid_hold_hours', 24)),
                           app.late_hold_until(coalesce(r.seated_at, r.created_at), e.starts_at)) end
    from app.event_registrations r
    join app.events e on e.id = r.event_id
    join app.users u on u.id = r.user_id
    left join app.member_profiles p on p.user_id = r.user_id
    left join app.payments pay on pay.id = r.payment_id and pay.status = 'succeeded'
    where r.event_id = p_event
    union all
    select w.user_id, u.member_number, p.first_name, p.last_name, w.sex, 'waitlisted'::app.registration_status,
           (row_number() over (partition by w.sex order by w.position))::integer,
           w.created_at, null, null, null, false, 0, null
    from app.waitlist_entries w
    join app.users u on u.id = w.user_id
    left join app.member_profiles p on p.user_id = w.user_id
    where w.event_id = p_event
    order by 5, 7 nulls first, 11 nulls last, 8;
end $$;

revoke all on function app.event_participants(uuid) from public;
grant execute on function app.event_participants(uuid) to authenticated, service_role;
