-- Phase 2, étape 5 : module « Paiements » de l'administration (section 11.2-9), en lecture.
--   - Réservé à la permission payments.read (administration et super administration).
--   - Transactions avec le membre et la soirée concernés, filtres d'état, d'objet et
--     de remboursement, recherche (prénom, nom, numéro de membre, référence du prestataire),
--     pagination côté serveur.
--   - Les remboursements eux-mêmes restent déclenchés par l'annulation d'une soirée
--     (migration 20261019000200) ; le rapprochement attend le choix du prestataire (question 7).

-- Liste paginée côté serveur. « total » : nombre de lignes du filtre.
-- p_refund : 'requested' (remboursement demandé, pas encore effectué) ou 'refunded'.
create function app.admin_payments(
  p_search text default null,
  p_status app.payment_status default null,
  p_purpose app.payment_purpose default null,
  p_refund text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  payment_id uuid,
  created_at timestamptz,
  user_id uuid,
  member_number text,
  first_name text,
  last_name text,
  purpose app.payment_purpose,
  amount_xof integer,
  provider app.payment_provider,
  provider_transaction_id text,
  status app.payment_status,
  refunded_amount_xof integer,
  refund_requested_at timestamptz,
  reconciled_at timestamptz,
  event_id uuid,
  event_starts_at timestamptz,
  total integer
)
language plpgsql stable security definer set search_path = app, public as $$
declare v_search text := nullif(btrim(p_search), '');
begin
  if not app.has_permission('payments.read') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_refund is not null and p_refund not in ('requested', 'refunded') then raise exception 'invalid_filter'; end if;
  return query
    select p.id, p.created_at, p.user_id, u.member_number, mp.first_name, mp.last_name,
           p.purpose, p.amount_xof, p.provider, p.provider_transaction_id, p.status,
           p.refunded_amount_xof, p.refund_requested_at, p.reconciled_at,
           r.event_id, e.starts_at,
           (count(*) over ())::integer
    from app.payments p
    left join app.users u on u.id = p.user_id
    left join app.member_profiles mp on mp.user_id = p.user_id
    left join app.event_registrations r on r.payment_id = p.id
    left join app.events e on e.id = r.event_id
    where (v_search is null
           or mp.first_name ilike '%' || v_search || '%'
           or mp.last_name ilike '%' || v_search || '%'
           or u.member_number ilike '%' || v_search || '%'
           or p.provider_transaction_id ilike '%' || v_search || '%')
      and (p_status is null or p.status = p_status)
      and (p_purpose is null or p.purpose = p_purpose)
      and (p_refund is null
           or (p_refund = 'requested' and p.refund_requested_at is not null and p.status = 'succeeded')
           or (p_refund = 'refunded' and p.status = 'refunded'))
    order by p.created_at desc, p.id
    limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end $$;

grant execute on function app.admin_payments(text, app.payment_status, app.payment_purpose, text, integer, integer) to authenticated, service_role;
