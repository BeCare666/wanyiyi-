-- Phase 2, étape 4 : dépôt du dossier de vérification par le membre (section 6.2-2).
-- Décisions du 17 octobre 2026 :
--   - une seule pièce : carte d'identité ou permis de conduire (recto et verso),
--     ou passeport (page photo) ;
--   - un selfie, visage seul ;
--   - déclaration sur l'honneur : célibataire, divorcé(e), veuf(ve) ou autre (précisé
--     par le membre, examiné par l'équipe), avec ou sans enfant(s).
-- Les fichiers vont dans le compartiment privé « id-documents » (10.1) : le membre
-- y dépose, mais ne peut ni relire, ni remplacer, ni supprimer. Toute écriture dans
-- les tables passe par les fonctions ci-dessous, qui contrôlent le dossier.

-- ---------------------------------------------------------------------
-- 1. Colonnes
-- ---------------------------------------------------------------------
alter table app.id_documents
  add column part text not null default 'front' check (part in ('front', 'back', 'photo_page', 'face')),
  add column superseded_at timestamptz;  -- remplacé par un nouveau dépôt (historique conservé)

alter table app.honor_declarations
  add column has_children boolean,
  add column other_details text check (char_length(other_details) <= 300),
  add constraint honor_declarations_status_check
    check (declared_marital_status in ('single', 'divorced', 'widowed', 'other'));

-- ---------------------------------------------------------------------
-- 2. Compartiment privé des pièces (Supabase Storage)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-documents', 'id-documents', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Dépôt seulement, dans son propre dossier « <identifiant du membre>/ ».
-- Aucune politique de lecture, de remplacement ni de suppression pour les membres.
create policy id_documents_upload_self on storage.objects for insert to authenticated
  with check (bucket_id = 'id-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 3. Plus d'écriture directe : tout passe par les fonctions
-- ---------------------------------------------------------------------
drop policy verifications_insert_self on app.verifications;
drop policy id_documents_insert_self on app.id_documents;
drop policy honor_self_insert on app.honor_declarations;

-- ---------------------------------------------------------------------
-- 4. Fonctions internes (non accessibles aux membres)
-- ---------------------------------------------------------------------
-- Vérification en cours du membre (créée au premier dépôt). Refus si elle est déjà tranchée.
create function app.open_verification(p_user uuid) returns app.verifications
language plpgsql security definer set search_path = app, public as $$
declare v_ver app.verifications;
begin
  select * into v_ver from app.verifications where user_id = p_user order by created_at desc limit 1 for update;
  if v_ver.id is null then
    insert into app.verifications (user_id) values (p_user) returning * into v_ver;
  elsif v_ver.status in ('approved', 'rejected') then
    raise exception 'verification_closed';
  end if;
  return v_ver;
end $$;

-- Dossier complet : pièce et selfie en vigueur, déclaration signée
create function app.dossier_complete(p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.honor_declarations h where h.user_id = p_user)
     and exists (
       select 1 from app.verifications v
       where v.user_id = p_user and v.status in ('pending', 'to_correct')
         and exists (select 1 from app.id_documents d where d.verification_id = v.id and d.superseded_at is null and d.kind = 'selfie')
         and exists (select 1 from app.id_documents d where d.verification_id = v.id and d.superseded_at is null and d.kind <> 'selfie')
     )
$$;

-- Après un dépôt du membre : un dossier complet repart en vérification
create function app.after_member_submission(p_verification uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_user uuid;
begin
  select user_id into v_user from app.verifications where id = p_verification;
  if not app.dossier_complete(v_user) then return; end if;
  update app.verifications set status = 'pending' where id = p_verification and status = 'to_correct';
  update app.member_profiles set status = 'pending_verification'
   where user_id = v_user and status in ('registering', 'to_correct');
end $$;

revoke execute on function app.open_verification(uuid), app.dossier_complete(uuid), app.after_member_submission(uuid) from public;

-- ---------------------------------------------------------------------
-- 5. Transitions d'état
-- ---------------------------------------------------------------------
-- Un nouveau dépôt après une demande de correction n'est pas une décision de l'équipe
create or replace function app.on_verification_decided() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'pending' then
      new.decided_by := null;
      new.decided_at := null;
      perform app.audit('verification.resubmitted', 'verifications', new.id);
      return new;
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
    update app.member_profiles
       set status = case new.status
                      when 'approved' then 'verified'::app.member_status
                      when 'to_correct' then 'to_correct'::app.member_status
                      when 'rejected' then 'excluded'::app.member_status
                      else 'pending_verification'::app.member_status
                    end,
           journey_stage = case when new.status = 'approved' then 'evenings'::app.journey_stage else journey_stage end
     where user_id = new.user_id;
    perform app.audit('verification.decided', 'verifications', new.id, jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;

-- Profil : l'état reste réservé à l'équipe, sauf une transition, et seulement quand
-- le dossier est réellement complet en base : inscription ou correction vers
-- « en attente de vérification ».
create or replace function app.protect_profile_columns() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_client() or app.is_team() then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'registering';
    new.journey_stage := 'registration';
    new.evenings_blocked_until := null;
  elsif (new.status is distinct from old.status
         and not (old.status in ('registering', 'to_correct') and new.status = 'pending_verification'
                  and app.dossier_complete(new.user_id)))
     or new.journey_stage is distinct from old.journey_stage
     or new.evenings_blocked_until is distinct from old.evenings_blocked_until
     or new.sex is distinct from old.sex
     or new.birth_date is distinct from old.birth_date then
    -- Sexe et date de naissance sont vérifiés sur la pièce d'identité : modifiables par l'équipe seulement
    raise exception 'forbidden_column' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. Fonctions du membre
-- ---------------------------------------------------------------------
-- Dépôt de la pièce et du selfie. Les fichiers doivent déjà être dans le compartiment,
-- dans le dossier du membre. Un nouveau dépôt remplace le précédent (historique conservé).
create function app.submit_id_documents(p_kind app.document_kind, p_front text, p_back text, p_selfie text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_ver app.verifications;
  v_paths text[];
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('id_card', 'passport', 'driving_licence') then raise exception 'invalid_document_kind'; end if;
  if p_front is null or p_selfie is null or (p_kind <> 'passport' and p_back is null) then raise exception 'document_missing'; end if;
  if p_kind = 'passport' and p_back is not null then raise exception 'invalid_document_kind'; end if;

  v_paths := array_remove(array[p_front, p_back, p_selfie], null);
  if (select count(distinct p) from unnest(v_paths) as p) <> cardinality(v_paths) then raise exception 'duplicate_file'; end if;
  if exists (
    select 1 from unnest(v_paths) as p
    where p not like v_uid::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'id-documents' and o.name = p)
  ) then
    raise exception 'file_not_found';
  end if;

  v_ver := app.open_verification(v_uid);
  update app.id_documents set superseded_at = now() where verification_id = v_ver.id and superseded_at is null;
  insert into app.id_documents (verification_id, kind, part, storage_path)
  values (v_ver.id, p_kind, case when p_kind = 'passport' then 'photo_page' else 'front' end, p_front);
  if p_back is not null then
    insert into app.id_documents (verification_id, kind, part, storage_path) values (v_ver.id, p_kind, 'back', p_back);
  end if;
  insert into app.id_documents (verification_id, kind, part, storage_path) values (v_ver.id, 'selfie', 'face', p_selfie);
  perform app.audit('id_document.submitted', 'verifications', v_ver.id, jsonb_build_object('kind', p_kind));
  perform app.after_member_submission(v_ver.id);
end $$;

-- Déclaration sur l'honneur. La version est celle du texte affiché au membre
-- (fichiers de traduction du site, Member.verification.declaration) ; seule la version en vigueur est acceptée.
create function app.sign_honor_declaration(p_status text, p_has_children boolean, p_other_details text, p_version text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_ver app.verifications;
  v_other text := nullif(btrim(p_other_details), '');
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_version is distinct from 'v1' then raise exception 'outdated_declaration'; end if;
  if p_status is null or p_status not in ('single', 'divorced', 'widowed', 'other') or p_has_children is null then
    raise exception 'invalid_declaration';
  end if;
  if (p_status = 'other') <> (v_other is not null) or char_length(v_other) > 300 then raise exception 'invalid_declaration'; end if;

  v_ver := app.open_verification(v_uid);
  insert into app.honor_declarations (user_id, declared_marital_status, has_children, other_details, text_version)
  values (v_uid, p_status, p_has_children, v_other, p_version);
  perform app.audit('honor.signed', 'verifications', v_ver.id, jsonb_build_object('version', p_version));
  perform app.after_member_submission(v_ver.id);
end $$;

-- Suivi pour le membre : état, note de correction, ce qui a été déposé (jamais les fichiers)
create function app.my_verification()
returns table (
  status app.verification_status,
  correction_note text,
  document_kind app.document_kind,
  documents_at timestamptz,
  has_selfie boolean,
  declared_status text,
  has_children boolean,
  other_details text,
  declaration_version text,
  signed_at timestamptz
)
language sql stable security definer set search_path = app, public as $$
  with v as (
    select * from app.verifications where user_id = auth.uid() order by created_at desc limit 1
  ), h as (
    select * from app.honor_declarations where user_id = auth.uid() order by signed_at desc limit 1
  )
  select v.status, v.correction_note,
         (select d.kind from app.id_documents d where d.verification_id = v.id and d.superseded_at is null and d.kind <> 'selfie' limit 1),
         (select max(d.uploaded_at) from app.id_documents d where d.verification_id = v.id and d.superseded_at is null),
         exists (select 1 from app.id_documents d where d.verification_id = v.id and d.superseded_at is null and d.kind = 'selfie'),
         h.declared_marital_status, h.has_children, h.other_details, h.text_version, h.signed_at
  from (select 1) as one
  left join v on true
  left join h on true
  where v.id is not null or h.id is not null
$$;

grant execute on function
  app.submit_id_documents(app.document_kind, text, text, text),
  app.sign_honor_declaration(text, boolean, text, text),
  app.my_verification()
to authenticated;
