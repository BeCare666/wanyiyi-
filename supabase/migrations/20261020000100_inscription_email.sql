-- Inscription par e-mail (décision du 20 octobre 2026) : e-mail et mot de passe, adresse confirmée
-- par un lien envoyé par l'API (Send Email Hook, via Brevo). Plus de code SMS : pas de frais d'envoi.
-- Le téléphone devient facultatif, ajouté par le membre dans ses Paramètres, sans vérification.
--   1. Le compte naît de l'inscription par e-mail (déclencheur on_auth_user_created, inchangé pour
--      le numéro de membre) ; la langue choisie à l'inscription est reprise sur le compte.
--   2. app.set_phone : seul chemin pour enregistrer ou retirer son numéro (format international,
--      un numéro par compte), journalisé.

create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  v_locale text := new.raw_user_meta_data ->> 'locale';
begin
  insert into app.users (id, phone, member_number, locale)
  values (
    new.id,
    new.phone,
    'W' || lpad(nextval('app.member_number_seq')::text, 6, '0'),
    case when v_locale in ('fr', 'en', 'yo') then v_locale::app.locale else 'fr' end
  );
  return new;
end $$;

-- Le numéro reste protégé contre l'écriture directe ; app.set_phone lève la protection
-- le temps de sa propre mise à jour (réglage local à la transaction, inaccessible au client).
create or replace function app.protect_user_columns() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_client() then return new; end if;
  if (new.phone is distinct from old.phone and coalesce(current_setting('app.phone_change', true), '') <> 'on')
     or new.member_number is distinct from old.member_number then
    raise exception 'forbidden_column' using errcode = '42501';
  end if;
  if new.role is distinct from old.role then
    if not app.has_permission('roles.manage') then
      raise exception 'forbidden_column' using errcode = '42501';
    end if;
    perform app.audit('role.changed', 'users', new.id, jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return new;
end $$;

-- Numéro du membre (null ou vide : retiré). Déclaratif : il n'est pas vérifié par SMS.
create function app.set_phone(p_phone text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_user uuid := auth.uid();
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s.()-]', '', 'g'), '');
begin
  if v_user is null or not exists (select 1 from app.users where id = v_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_phone'; end if;
  if v_phone is not null and exists (select 1 from app.users where phone = v_phone and id <> v_user) then
    raise exception 'phone_taken';
  end if;
  perform set_config('app.phone_change', 'on', true);
  update app.users set phone = v_phone where id = v_user;
  perform set_config('app.phone_change', '', true);
  perform app.audit('member.phone_changed', 'users', v_user, jsonb_build_object('removed', v_phone is null));
end $$;

grant execute on function app.set_phone(text) to authenticated;
