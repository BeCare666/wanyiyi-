import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { refreshSession } from "./lib/supabase/proxy";

const intl = createMiddleware(routing);

/** Langue (next-intl), puis rafraîchissement de la session Supabase du membre. */
export default async function proxy(request: NextRequest) {
  return refreshSession(request, intl(request));
}

export const config = {
  // Toutes les pages, sauf l'API, les fichiers internes de Next.js et les fichiers statiques
  // « \\. » : un point littéral (fichiers statiques). Avec « \. », la barre disparaît dans la chaîne
  // et le motif excluait toute adresse sauf « / » (pages françaises sans préfixe en 404).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
