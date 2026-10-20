import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Page ouverte après chaque type de lien, dans la langue du lien. */
const DESTINATIONS: Partial<Record<EmailOtpType, string>> = {
  signup: "/inscription",
  email: "/inscription",
  recovery: "/nouveau-mot-de-passe",
  email_change: "/espace/parametres?email=confirme",
};

/**
 * Lien des e-mails d'authentification (inscription, mot de passe oublié, changement d'adresse),
 * construit par le hook de l'API : vérification du jeton côté serveur (verifyOtp avec token_hash,
 * méthode documentée par Supabase pour le rendu serveur), qui connecte le membre par cookies.
 * Fonctionne aussi sur un autre appareil que celui de la demande. Lien invalide ou déjà utilisé :
 * retour à la connexion avec un message.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const destination = type ? DESTINATIONS[type] : undefined;
  const supabase = await createSupabaseServer();
  if (tokenHash && type && destination && supabase) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect(`${prefix}${destination}`);
  }
  redirect(`${prefix}/connexion?lien=invalide`);
}
