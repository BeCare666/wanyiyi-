import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { channelsFrom, isLocale, type Settings } from "./settings";
import { EmailForm } from "./EmailForm";
import { SettingsForm } from "./SettingsForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.settings");
  return { title: t("title") };
}

/** Paramètres enregistrés du membre, lus avec son jeton (RLS). */
async function loadSettings(userId: string): Promise<Settings> {
  const supabase = await createSupabaseServer();
  const [user, prefs] = await Promise.all([
    supabase?.from("users").select("locale, dark_mode").eq("id", userId).maybeSingle(),
    supabase?.from("notification_preferences").select("channel, enabled"),
  ]);
  const locale: unknown = user?.data?.locale;
  return {
    locale: isLocale(locale) ? locale : "fr",
    darkMode: Boolean(user?.data?.dark_mode),
    channels: channelsFrom((prefs?.data ?? []) as { channel: string; enabled: boolean }[]),
  };
}

type Props = { searchParams: Promise<{ email?: string | string[] }> };

/** Adresse confirmée et adresse en attente de confirmation (Supabase Auth). */
async function loadEmail() {
  const supabase = await createSupabaseServer();
  const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
  return { current: data.user?.email || null, pending: data.user?.new_email || null };
}

/**
 * Paramètres (section 6.2-9) : langue, mode sombre, canaux de notification, adresse e-mail
 * facultative (19 octobre 2026). ?email=echec : l'adresse donnée à l'inscription n'a pas été acceptée.
 * Confidentialité, téléchargement des données et suppression du compte attendent
 * les règles demandées (PHASE2.txt, questions 15 à 17).
 */
export default async function SettingsPage({ searchParams }: Props) {
  const t = await getTranslations("Member");
  const member = await getSessionMember();
  if (!member) return null;
  const [settings, email] = await Promise.all([loadSettings(member.id), loadEmail()]);
  const failedAtSignup = (await searchParams).email === "echec";

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("nav.settings")}
        </p>
        <h1 className="mt-6 text-4xl">{t("settings.title")}</h1>
      </header>
      <SettingsForm initial={settings} />
      <EmailForm current={email.current} pending={email.pending} failedAtSignup={failedAtSignup} />
    </div>
  );
}
