-- Blocage des coordonnées dans les textes du profil (section 8.1), aussi dans la base.
-- Jusqu'ici seule l'API filtrait (checkFreeText de packages/domain/src/textGuard.ts) : un membre
-- pouvait écrire directement dans app.profile_texts (politique profile_texts_self) sans ce filtre.
-- Le même filtre est refait ici, règle pour règle, et appliqué à toute écriture d'un texte :
-- numéros de téléphone (chiffres, lettres en français, anglais, yoruba, « o » pour 0), adresses
-- e-mail (même déguisées), liens, pseudos de réseaux sociaux. La longueur reste contrôlée par la
-- contrainte de la table (300 caractères). Toute modification du filtre de l'API doit être reportée
-- ici : le test supabase/tests/filtre-textes.test.ts compare les deux sur les mêmes textes.
-- Les textes déjà enregistrés ne sont pas relus ; ils restent soumis à la relecture de l'équipe.
-- Les limites de mot (\b de JavaScript, lettres ASCII seulement) sont écrites avec des
-- assertions explicites pour donner exactement les mêmes résultats que l'API.

-- Nombres écrits en lettres remplacés par leurs chiffres (même découpage que wordsToDigits)
create function app.words_to_digits(p_text text)
returns text
language plpgsql immutable set search_path = app, public as $$
declare
  v_digits constant jsonb := '{"zero":"0","un":"1","une":"1","deux":"2","trois":"3","quatre":"4","cinq":"5","six":"6","sept":"7","huit":"8","neuf":"9",
    "oh":"0","one":"1","two":"2","three":"3","four":"4","five":"5","seven":"7","eight":"8","nine":"9",
    "odo":"0","okan":"1","eji":"2","eta":"3","erin":"4","arun":"5","efa":"6","eje":"7","ejo":"8","esan":"9"}';
  v_teens constant jsonb := '{"dix":10,"onze":11,"douze":12,"treize":13,"quatorze":14,"quinze":15,"seize":16}';
  v_tens constant jsonb := '{"vingt":20,"vingts":20,"trente":30,"quarante":40,"cinquante":50,"soixante":60}';
  v_tokens text[];
  v_out text := '';
  n int;
  i int := 1;
  j int;
  v_tok text;
  v_word text;
  v_tens_value int;
  v_rest int;
  v_consumed int;
begin
  -- Minuscules sans accents, découpées en mots [a-z0-9]+ et séparateurs
  select coalesce(array_agg(m[1] order by ord), '{}') into v_tokens
  from regexp_matches(regexp_replace(normalize(lower(p_text), NFD), '[\u0300-\u036f]', '', 'g'), '([a-z0-9]+|[^a-z0-9]+)', 'g')
    with ordinality as t(m, ord);
  n := coalesce(array_length(v_tokens, 1), 0);
  while i <= n loop
    v_tok := v_tokens[i];
    v_tens_value := null;
    v_consumed := 0;
    -- « quatre-vingt(s) » et les dizaines, suivis d'un complément (dix, onze… dix-neuf ou unité)
    if v_tok = 'quatre' and coalesce(v_tokens[i + 1], '') ~ '^-\s*$' and coalesce(v_tokens[i + 2], '') ~ '^vingts?$' then
      v_tens_value := 80;
      v_consumed := 2;
    elsif v_tens ? v_tok then
      v_tens_value := (v_tens ->> v_tok)::int;
    end if;
    if v_tens_value is not null then
      j := i + v_consumed + 1;
      v_rest := 0;
      while j <= n and v_tokens[j] ~ '^[^a-z0-9]+$' loop j := j + 1; end loop;
      v_word := coalesce(v_tokens[j], '');
      if v_word = 'et' then
        j := j + 1;
        while j <= n and v_tokens[j] ~ '^[^a-z0-9]+$' loop j := j + 1; end loop;
        v_word := coalesce(v_tokens[j], '');
      end if;
      if v_teens ? v_word then
        v_rest := (v_teens ->> v_word)::int;
        j := j + 1;
        if v_word = 'dix' then
          while j <= n and v_tokens[j] ~ '^[^a-z0-9]+$' loop j := j + 1; end loop;
          if coalesce(v_tokens[j], '') in ('sept', 'huit', 'neuf') then
            v_rest := v_rest + (v_digits ->> v_tokens[j])::int;
            j := j + 1;
          end if;
        end if;
      elsif v_digits ? v_word and v_word <> 'zero' then
        v_rest := (v_digits ->> v_word)::int;
        j := j + 1;
      end if;
      v_out := v_out || (v_tens_value + v_rest)::text;
      i := j;
      continue;
    end if;
    if v_teens ? v_tok then
      v_out := v_out || (v_teens ->> v_tok);
    else
      v_out := v_out || coalesce(v_digits ->> v_tok, v_tok);
    end if;
    i := i + 1;
  end loop;
  return v_out;
end $$;

-- Coordonnées trouvées dans un texte : email, link, social_handle, phone (ordre de l'API)
create function app.text_contact_issues(p_body text)
returns text[]
language plpgsql immutable set search_path = app, public as $$
declare
  v_issues text[] := '{}';
  v_digits text;
begin
  if p_body ~* '[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\s+at\s+|\s+arobase\s+)\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\s+dot\s+|\s+point\s+)\s*[a-z]{2,}' then
    v_issues := v_issues || 'email'::text;
  end if;
  if p_body ~* '(?:https?://|www\.)\S+|(?<![a-z0-9_])wa\.me(?![a-z0-9_])|(?:(?<![a-z0-9_])[a-z0-9]|(?<=[a-z0-9_])-)[a-z0-9-]*\.(?:com|net|org|bj|fr|me|io|co|info|biz|africa|link|ly)(?![a-z0-9_])' then
    v_issues := v_issues || 'link'::text;
  end if;
  if p_body ~* '(?:^|[\s(])@[a-z0-9._]{2,}'
     or p_body ~* '(?<![a-z0-9_])(?:insta(?:gram)?|ig|snap(?:chat)?|tik\s?tok|facebook|fb|telegram|whats\s?app|twitter|linkedin)\s*(?::|=|->|@)\s*\S+' then
    v_issues := v_issues || 'social_handle'::text;
  end if;
  -- Au moins 8 chiffres à la suite, séparateurs usuels compris ; « o » collé à un chiffre = 0
  v_digits := regexp_replace(app.words_to_digits(p_body), '(?<=[0-9])[oO]|[oO](?=[0-9])', '0', 'g');
  v_digits := regexp_replace(v_digits, '(?<=[0-9+])[\s./()_,-]+(?=[0-9(])', '', 'g');
  if v_digits ~ '[0-9]{8,}' then
    v_issues := v_issues || 'phone'::text;
  end if;
  return v_issues;
end $$;

-- Toute écriture d'un texte (membre, API ou équipe) : refusée s'il contient des coordonnées
create function app.guard_profile_text() returns trigger
language plpgsql set search_path = app, public as $$
declare
  v_issues text[];
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then return new; end if;
  v_issues := app.text_contact_issues(new.body);
  if cardinality(v_issues) > 0 then
    raise exception 'text_rejected' using errcode = 'check_violation', detail = array_to_string(v_issues, ',');
  end if;
  return new;
end $$;

create trigger profile_texts_guard before insert or update of body on app.profile_texts
  for each row execute function app.guard_profile_text();

revoke execute on function app.words_to_digits(text) from public;
revoke execute on function app.text_contact_issues(text) from public;
grant execute on function app.words_to_digits(text) to authenticated, service_role;
grant execute on function app.text_contact_issues(text) to authenticated, service_role;
