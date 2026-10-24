"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { checkTheme, type ThemeInput, themeParams } from "./themes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nouveau thème : app.save_theme contrôle la permission events.manage et journalise. */
export async function createTheme(input: ThemeInput): Promise<ApiResult<void>> {
  const invalid = checkTheme(input);
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("save_theme", { p_id: null, ...themeParams(input) });
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  return { ok: true, data: undefined };
}

/** Suppression d'un thème jamais utilisé par une soirée (app.delete_theme). */
export async function deleteTheme(id: string): Promise<ApiResult<void>> {
  if (!UUID.test(id)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("delete_theme", { p_id: id });
  if (error) return { ok: false, error: error.message === "theme_in_use" ? "theme_in_use" : error.code === "42501" ? "forbidden" : "generic" };
  return { ok: true, data: undefined };
}
