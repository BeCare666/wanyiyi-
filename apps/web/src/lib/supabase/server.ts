import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { dbSchema, supabaseConfig } from "./config";

/**
 * Client Supabase côté serveur, au nom du membre connecté (cookies de session) :
 * chaque requête passe par la RLS. Jamais de clé service role sur le site.
 */
export async function createSupabaseServer() {
  const config = supabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.anonKey, {
    db: { schema: dbSchema },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Composant serveur : écriture impossible, le proxy rafraîchit déjà la session
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {}
      },
    },
  });
}
