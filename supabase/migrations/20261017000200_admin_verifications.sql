-- Phase 2, étape 5 : module « Vérifications » de l'administration (section 11.2-3).
-- Décisions du 17 octobre 2026 :
--   - validation possible dès que la pièce, le selfie et la déclaration sont déposés
--     (pas de blocage sur l'entretien ni sur les frais) ;
--   - vérification réservée à l'administration et à la super administration
--     (permission verifications.review, inchangée : pas les modérateurs) ;
--   - lien vers une pièce : URL signée de 5 minutes, chaque ouverture journalisée
--     (app.open_id_document, puis l'API crée le lien).

insert into app.settings (key, value) values ('safety.signed_id_document_url_seconds', '300')
on conflict (key) do nothing;

-- La décision passe par app.decide_verification : plus d'écriture directe par l'équipe
drop policy verifications_review on app.verifications;
create policy verifications_select_review on app.verifications for select using (app.has_permission('verifications.review'));

-- File d'attente : dossiers en attente ou à corriger, les plus anciens d'abord.
-- « ready » : dossier complet (pièce, selfie, déclaration), donc validable.
create function app.verification_queue()
returns table (
  verification_id uuid,
  user_id uuid,
  member_number text,
  first_name text,
  last_name text,
  status app.verification_status,
  submitted_at timestamptz,
  document_kind app.document_kind,
  has_selfie boolean,
  declared_status text,
  ready boolean
)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('verifications.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select v.id, v.user_id, u.member_number, p.first_name, p.last_name, v.status,
           greatest(
             (select max(d.uploaded_at) from app.id_documents d where d.verification_id = v.id and d.superseded_at is null),
             (select max(h.signed_at) from app.honor_declarations h where h.user_id = v.user_id)
           ),
           (select d.kind from app.id_documents d where d.verification_id = v.id and d.superseded_at is null and d.kind <> 'selfie' limit 1),
           exists (select 1 from app.id_documents d where d.verification_id = v.id and d.superseded_at is null and d.kind = 'selfie'),
           (select h.declared_marital_status from app.honor_declarations h where h.user_id = v.user_id order by h.signed_at desc limit 1),
           app.dossier_complete(v.user_id)
    from app.verifications v
    join app.users u on u.id = v.user_id
    left join app.member_profiles p on p.user_id = v.user_id
    where v.status in ('pending', 'to_correct')
    order by 7 nulls last, v.created_at;
end $$;

-- Pièces en vigueur d'un dossier, sans leur chemin : il ne s'obtient que par
-- app.open_id_document, qui journalise chaque ouverture.
create function app.verification_documents(p_verification uuid)
returns table (id uuid, kind app.document_kind, part text, uploaded_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('verifications.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select d.id, d.kind, d.part, d.uploaded_at from app.id_documents d
    where d.verification_id = p_verification and d.superseded_at is null
    order by case d.part when 'front' then 1 when 'photo_page' then 1 when 'back' then 2 else 3 end;
end $$;

-- Décision de l'équipe. Le déclencheur verifications_decided met à jour l'état du membre
-- et journalise la décision.
create function app.decide_verification(p_verification uuid, p_status app.verification_status, p_note text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_ver app.verifications;
  v_note text := nullif(btrim(p_note), '');
begin
  if not app.has_permission('verifications.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ver from app.verifications where id = p_verification for update;
  if v_ver.id is null then raise exception 'not_found'; end if;
  if v_ver.status not in ('pending', 'to_correct') then raise exception 'verification_closed'; end if;
  if p_status not in ('approved', 'to_correct', 'rejected') then raise exception 'invalid_status'; end if;
  if p_status = 'to_correct' and v_note is null then raise exception 'note_required'; end if;
  if p_status = 'approved' then
    if not exists (select 1 from app.member_profiles where user_id = v_ver.user_id) then raise exception 'profile_missing'; end if;
    if not app.dossier_complete(v_ver.user_id) then raise exception 'dossier_incomplete'; end if;
  end if;
  update app.verifications set status = p_status, correction_note = v_note where id = p_verification;
end $$;

grant execute on function
  app.verification_queue(),
  app.verification_documents(uuid),
  app.decide_verification(uuid, app.verification_status, text)
to authenticated;
