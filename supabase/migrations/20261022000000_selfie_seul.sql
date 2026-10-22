-- Vérification sans pièce d'identité (question 29, 22 octobre 2026) : le dossier se compose du
-- selfie pris en direct et de la déclaration sur l'honneur ; l'équipe regarde le selfie et valide.
-- Les pièces déjà déposées restent dans l'historique (et visibles par l'équipe), mais ne sont plus
-- demandées ni acceptées.

-- Dossier complet : selfie en vigueur et déclaration signée
create or replace function app.dossier_complete(p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.honor_declarations h where h.user_id = p_user)
     and exists (
       select 1 from app.verifications v
       where v.user_id = p_user and v.status in ('pending', 'to_correct')
         and exists (select 1 from app.id_documents d where d.verification_id = v.id and d.superseded_at is null and d.kind = 'selfie')
     )
$$;

-- Dépôt du selfie. Le fichier doit déjà être dans le compartiment privé, dans le dossier du membre.
-- Un nouveau selfie remplace le précédent (historique conservé).
create function app.submit_selfie(p_selfie text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_ver app.verifications;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_selfie is null then raise exception 'document_missing'; end if;
  if p_selfie not like v_uid::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'id-documents' and o.name = p_selfie) then
    raise exception 'file_not_found';
  end if;

  v_ver := app.open_verification(v_uid);
  update app.id_documents set superseded_at = now()
   where verification_id = v_ver.id and superseded_at is null and kind = 'selfie';
  insert into app.id_documents (verification_id, kind, part, storage_path) values (v_ver.id, 'selfie', 'face', p_selfie);
  perform app.audit('selfie.submitted', 'verifications', v_ver.id, '{}'::jsonb);
  perform app.after_member_submission(v_ver.id);
end $$;

revoke execute on function app.submit_selfie(text) from public;
grant execute on function app.submit_selfie(text) to authenticated;

-- Plus aucun dépôt de pièce d'identité
drop function app.submit_id_documents(app.document_kind, text, text, text);
