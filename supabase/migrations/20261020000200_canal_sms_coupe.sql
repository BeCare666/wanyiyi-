-- Canal SMS coupé (décision du 20 octobre 2026, question 26) : plus aucun SMS envoyé aux membres,
-- pour éviter les frais d'envoi. Les notifications passent par l'espace membre et l'e-mail.
-- Les préférences « sms » déjà enregistrées restent en base, sans effet.

create or replace function app.notify_with_deliveries(p_user uuid, p_kind text, p_payload jsonb) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_id uuid;
begin
  insert into app.notifications (user_id, kind, payload) values (p_user, p_kind, p_payload) returning id into v_id;
  insert into app.notification_deliveries (notification_id, channel)
  select v_id, 'email'::app.notification_channel
  where coalesce((select np.enabled from app.notification_preferences np where np.user_id = p_user and np.channel = 'email'), true);
end $$;

-- SMS encore en file : abandonnés
update app.notification_deliveries
set status = 'failed', last_error = 'canal SMS coupé (20 octobre 2026)'
where channel = 'sms' and status = 'queued';
