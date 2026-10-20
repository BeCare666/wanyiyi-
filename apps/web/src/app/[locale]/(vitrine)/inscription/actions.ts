"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { checkIdentity, type Identity } from "./registration";

/**
 * Dernière étape de l'inscription : consentement et identité, avec le jeton du membre tout juste
 * connecté par le lien de confirmation de son adresse. app.complete_registration contrôle à nouveau chaque règle.
 */
export async function completeRegistration(identity: Identity): Promise<ApiResult<void>> {
  const invalid = checkIdentity(identity, new Date());
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("complete_registration", {
    p_first_name: identity.firstName.trim(),
    p_last_name: identity.lastName.trim(),
    p_sex: identity.sex,
    p_birth_date: identity.birthDate,
    p_city: identity.city.trim() || null,
    p_consent: identity.consent,
  });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
