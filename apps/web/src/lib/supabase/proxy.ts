import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { supabaseConfig } from "./config";

/**
 * Rafraîchit la session Supabase à chaque page (jeton expiré renouvelé, cookies réécrits
 * sur la réponse préparée par next-intl). Sans projet configuré, la réponse est inchangée.
 */
export async function refreshSession(request: NextRequest, response: NextResponse): Promise<NextResponse> {
  const config = supabaseConfig();
  if (!config) return response;
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Vérifie le jeton (clés publiques du projet) et le renouvelle si besoin
  await supabase.auth.getClaims();
  return response;
}
