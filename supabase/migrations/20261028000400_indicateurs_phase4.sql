-- Phase 4, étape 7 : indicateurs du tableau de bord de l'administration (question 6 de
-- propositions/PROPOSITIONS-QUESTIONS-PHASE4.txt, validée le 27 octobre 2026) : cagnottes
-- ouvertes et montant total collecté, reversements en attente, parrainages acquis dans le mois,
-- prestataires actifs et « J'ai contacté ce prestataire » dans le mois.
-- Chaque indicateur n'est rendu qu'avec la permission de son module (null sinon) ; « le mois » est
-- le mois civil en cours, heure de Cotonou.

create function app.admin_phase4_indicators()
returns table (open_cagnottes integer, collected_xof bigint, pending_payouts integer, referrals_this_month integer,
               active_providers integer, provider_contacts_this_month integer)
language plpgsql stable security definer set search_path = app, public as $$
declare
  v_month_start timestamptz := (date_trunc('month', now() at time zone 'Africa/Porto-Novo') at time zone 'Africa/Porto-Novo');
  v_cagnottes boolean := app.has_permission('cagnottes.manage');
  v_members boolean := app.has_permission('members.manage');
  v_providers boolean := app.has_permission('providers.manage');
begin
  if not (v_cagnottes or v_members or v_providers) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select
    case when v_cagnottes then (select count(*)::integer from app.cagnottes where status = 'open') end,
    case when v_cagnottes then (select coalesce(sum(c.amount_xof), 0)::bigint
                                  from app.contributions c join app.payments p on p.id = c.payment_id where p.status = 'succeeded') end,
    case when v_cagnottes then (select count(*)::integer from app.cagnotte_payouts where status = 'requested') end,
    case when v_members then (select count(*)::integer from app.referrals where acquired_at >= v_month_start) end,
    case when v_providers then (select count(*)::integer from app.providers where is_active) end,
    case when v_providers then (select count(*)::integer from app.provider_contacts where created_at >= v_month_start) end;
end $$;

grant execute on function app.admin_phase4_indicators() to authenticated, service_role;
