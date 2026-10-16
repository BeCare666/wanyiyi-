-- Phase 2, étape 4 : page « Notifications » de l'espace membre.
-- Jusqu'ici, la politique notifications_update_self laissait le membre modifier toute la
-- ligne de ses notifications (type, contenu, date). Comme pour les autres tables, l'écriture
-- passe désormais par une fonction qui ne touche qu'à la date de lecture.

drop policy notifications_update_self on app.notifications;
revoke update on app.notifications from authenticated;

-- Marque comme lues les notifications non lues du membre : celles de la liste, ou toutes (null).
-- Renvoie le nombre de notifications marquées.
create function app.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = app, public as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  update app.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function app.mark_notifications_read(uuid[]) to authenticated;

-- Paramètres (section 6.2-9) : canaux de notification choisis par le membre.
-- Sans ligne pour un canal, il est actif (valeur par défaut de la table).
create policy notification_preferences_self on app.notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
