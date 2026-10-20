"use client";

import { createBrowserClient } from "@supabase/ssr";
import { dbSchema, supabaseConfig } from "./config";

/** Client Supabase du navigateur (inscription et connexion par e-mail). null si le projet n'est pas configuré. */
export function createSupabaseBrowser() {
  const config = supabaseConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.anonKey, { db: { schema: dbSchema } });
}
