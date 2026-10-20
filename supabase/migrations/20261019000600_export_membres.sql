-- Phase 2, étape 5 : export CSV et Excel de la liste des membres filtrée (section 11.3).
-- Décisions du 19 octobre 2026 (question 23) :
--   - bibliothèque « exceljs » acceptée pour le fichier Excel (produit par le site) ;
--   - les numéros de téléphone ne figurent dans un export que pour la super administration.
-- Même filtre et même tri que la liste (app.member_rows_sql) ; 5 000 lignes au plus ;
-- chaque export est journalisé (format, nombre de lignes, téléphones inclus ou non, filtre).

create function app.admin_members_export(p_filter jsonb, p_sort jsonb, p_format text)
returns table (
  user_id uuid,
  member_number text,
  phone text,
  role app.role,
  first_name text,
  last_name text,
  sex app.sex,
  birth_date date,
  city text,
  status app.member_status,
  created_at timestamptz,
  evenings_attended integer,
  matches integer,
  total integer
)
language plpgsql security definer set search_path = app, public as $$
declare
  v_phone boolean := app.has_role(array['super_admin']::app.role[]);
  v_count integer;
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_format not in ('csv', 'xlsx') then raise exception 'invalid_format'; end if;
  return query execute format($q$
    select x.user_id, x.member_number, case when %L::boolean then x.phone end, x.role, x.first_name, x.last_name, x.sex,
           x.birth_date, x.city, x.status, x.created_at, x.evenings_attended, x.matches, x.total
    from (%s limit 5000) x
  $q$, v_phone, app.member_rows_sql(p_filter, p_sort));
  get diagnostics v_count = row_count;
  perform app.audit('members.exported', 'users', null,
    jsonb_build_object('format', p_format, 'rows', v_count, 'phone', v_phone, 'filter', p_filter, 'sort', p_sort));
end $$;

grant execute on function app.admin_members_export(jsonb, jsonb, text) to authenticated, service_role;
