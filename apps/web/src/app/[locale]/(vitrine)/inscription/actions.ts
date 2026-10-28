"use server";

import type { ApiResult } from "@/lib/api";
import { isReferralCode, normalizeReferralCode } from "@/lib/referral";
import { createSupabaseServer } from "@/lib/supabase/server";
import { checkIdentity, type Identity } from "./registration";

/**
 * Dernière étape de l'inscription : consentement et identité, avec le jeton du membre tout juste
 * connecté par le lien de confirmation de son adresse. app.complete_registration contrôle à nouveau chaque règle.
 */
export async function completeRegistration(identity: Identity, referralCode = ""): Promise<ApiResult<void>> {
  const invalid = checkIdentity(identity, new Date());
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  // Code de parrainage facultatif (phase 4, question 4 b) : vérifié avant de créer le profil
  const code = normalizeReferralCode(referralCode);
  if (code !== "") {
    if (!isReferralCode(code)) return { ok: false, error: "invalid_referral_code" };
    const { data: valid } = await supabase.rpc("referral_code_valid", { p_code: code });
    if (valid !== true) return { ok: false, error: "invalid_referral_code" };
  }
  const { error } = await supabase.rpc("complete_registration", {
    p_first_name: identity.firstName.trim(),
    p_last_name: identity.lastName.trim(),
    p_sex: identity.sex,
    p_birth_date: identity.birthDate,
    p_city: identity.city.trim() || null,
    p_consent: identity.consent,
  });
  if (error) return { ok: false, error: error.message };
  if (code !== "") {
    const { error: referralError } = await supabase.rpc("set_referrer", { p_code: code });
    // Profil créé : un code devenu invalide entre-temps n'empêche pas l'inscription
    if (referralError && referralError.message !== "already_referred") return { ok: true, data: undefined };
  }
  return { ok: true, data: undefined };
}
