"use server";

import type { ApiResult } from "@/lib/api";
import { checkProvider, cleanPhone, type Localized, type ProviderInput, validCategoryKey } from "@/lib/providers";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Appel d'une fonction de la base avec le jeton de la personne : permission providers.manage revérifiée. */
async function call<T>(fn: string, args: Record<string, unknown>): Promise<ApiResult<T>> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : error.message };
  return { ok: true, data: data as T };
}

/** Création (id null) ou modification d'un prestataire (phase 4, question 2). */
export async function saveProvider(id: string | null, input: ProviderInput): Promise<ApiResult<string>> {
  if (id !== null && !UUID.test(id)) return { ok: false, error: "generic" };
  const invalid = checkProvider(input);
  if (invalid) return { ok: false, error: invalid };
  return call<string>("admin_save_provider", {
    p_id: id,
    p_name: input.name.trim(),
    p_category: input.category,
    p_description: input.description,
    p_phone: cleanPhone(input.phone) || null,
    p_whatsapp: cleanPhone(input.whatsapp) || null,
    p_city: input.city.trim(),
    p_district: input.district.trim() || null,
    p_price_range: input.priceRange.trim() || null,
    p_is_demo: input.isDemo,
  });
}

/** Désactivation (masqué de la vitrine et des couples) ou réactivation. */
export async function setProviderActive(id: string, active: boolean): Promise<ApiResult<void>> {
  if (!UUID.test(id) || typeof active !== "boolean") return { ok: false, error: "generic" };
  return call<void>("admin_set_provider_active", { p_id: id, p_active: active });
}

/** Catégorie : nouvelle clé = création ; nom en 3 langues (français obligatoire), ordre, active. */
export async function saveCategory(key: string, name: Localized, position: number, active: boolean): Promise<ApiResult<void>> {
  if (!validCategoryKey(key)) return { ok: false, error: "invalid_key" };
  if ((name.fr ?? "").trim() === "") return { ok: false, error: "name_required" };
  if (!Number.isInteger(position) || position < 0 || position > 1000) return { ok: false, error: "invalid_position" };
  return call<void>("admin_save_provider_category", { p_key: key, p_name: name, p_position: position, p_active: active });
}
