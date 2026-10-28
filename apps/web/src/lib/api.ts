import { createSupabaseServer } from "@/lib/supabase/server";

/** Réponse de l'API Wanyiyi : données, ou code d'erreur (clé de traduction). */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Appel de l'API NestJS au nom du membre connecté : son jeton est transmis,
 * l'API le vérifie et la RLS s'applique dans la base. Uniquement côté serveur.
 */
export async function memberApi<T>(path: string, init?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown }): Promise<ApiResult<T>> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  const supabase = await createSupabaseServer();
  if (!base || !supabase) return { ok: false, error: "unavailable" };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "not_authenticated" };

  try {
    const response = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      // Un fichier (FormData) part tel quel : fetch fixe lui-même l'en-tête multipart
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body === undefined || init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      },
      body: init?.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
      cache: "no-store",
    });
    if (!response.ok) {
      // Les erreurs métier de l'API portent leur code dans « message » (db-errors.ts)
      const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
      return { ok: false, error: typeof payload?.message === "string" ? payload.message : "generic" };
    }
    if (response.status === 204) return { ok: true, data: undefined as T };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * Appel public de l'API, sans jeton (contribution à une cagnotte par une personne sans compte,
 * phase 4). Uniquement côté serveur ; l'API n'ouvre ainsi que ses routes publiques.
 */
export async function publicApi<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<ApiResult<T>> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) return { ok: false, error: "unavailable" };
  try {
    const response = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? {} : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
      return { ok: false, error: typeof payload?.message === "string" ? payload.message : "generic" };
    }
    if (response.status === 204) return { ok: true, data: undefined as T };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
