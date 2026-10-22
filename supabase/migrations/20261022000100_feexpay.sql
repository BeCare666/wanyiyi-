-- FeexPay remplace KkiaPay (question 29, 22 octobre 2026). Paiement demandé par l'API
-- (Mobile Money MTN, Moov, Celtiis ou carte), statut toujours relu chez FeexPay.
-- Remboursement d'une soirée annulée : manuel. La plateforme marque le paiement « à rembourser »
-- (app.cancel_event, inchangé) ; l'équipe rembourse depuis le tableau de bord FeexPay, puis le
-- marque « remboursé » ici.

alter type app.payment_provider add value if not exists 'feexpay';

-- Équipe des paiements : celle qui les consulte (payments.read)
insert into app.role_permissions (role, permission) values
  ('admin', 'payments.refund'), ('super_admin', 'payments.refund');

-- Remboursement fait à la main chez FeexPay : montant intégral, journalisé au nom de l'équipier
create function app.admin_mark_refunded(p_payment uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('payments.refund') then raise exception 'forbidden' using errcode = '42501'; end if;
  update app.payments set status = 'refunded', refunded_amount_xof = amount_xof
   where id = p_payment and status = 'succeeded' and refund_requested_at is not null;
  if not found then raise exception 'not_refundable'; end if;
  perform app.audit('payment.refunded_manually', 'payments', p_payment);
end $$;

revoke execute on function app.admin_mark_refunded(uuid) from public;
grant execute on function app.admin_mark_refunded(uuid) to authenticated;
