import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link, getPathname } from "@/i18n/navigation";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { channelsFrom, type Deletion, isLocale, privacyFrom, type Settings } from "./settings";
import { DeletionForm } from "./DeletionForm";
import { EmailForm } from "./EmailForm";
import { PhoneForm } from "./PhoneForm";
import { PrivacyForm } from "./PrivacyForm";
import { SettingsForm } from "./SettingsForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.settings");
  return { title: t("title") };
}

/** Paramètres enregistrés du membre, lus avec son jeton (RLS). */
async function loadSettings(userId: string): Promise<Settings & { phone: string | null }> {
  const supabase = await createSupabaseServer();
  const [user, prefs] = await Promise.all([
    supabase?.from("users").select("locale, dark_mode, phone").eq("id", userId).maybeSingle(),
    supabase?.from("notification_preferences").select("channel, enabled"),
  ]);
  const locale: unknown = user?.data?.locale;
  return {
    locale: isLocale(locale) ? locale : "fr",
    darkMode: Boolean(user?.data?.dark_mode),
    channels: channelsFrom((prefs?.data ?? []) as { channel: string; enabled: boolean }[]),
    phone: (user?.data?.phone as string | null | undefined) ?? null,
  };
}

/** Confidentialité (question 15) et demande de suppression en cours (question 17), lues avec le jeton du membre. */
async function loadPrivacyAndDeletion(userId: string) {
  const supabase = await createSupabaseServer();
  const [profile, deletion] = await Promise.all([
    supabase?.from("member_profiles").select("photo_blurred, share_phone, keep_photo_blurred").eq("user_id", userId).maybeSingle(),
    supabase?.from("account_deletions").select("requested_at, purge_after").eq("user_id", userId).is("purged_at", null).maybeSingle(),
  ]);
  const row = deletion?.data as { requested_at: string; purge_after: string } | null | undefined;
  return {
    privacy: privacyFrom(profile?.data as { photo_blurred: boolean; share_phone: boolean; keep_photo_blurred: boolean } | null),
    deletion: (row ? { requestedAt: row.requested_at, purgeAfter: row.purge_after } : null) satisfies Deletion,
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
 * Paramètres (section 6.2-9) : langue, mode sombre, canaux de notification, adresse e-mail du compte
 * et téléphone facultatif (20 octobre 2026). ?email=confirme : retour du lien de changement d'adresse
 * (confirmé seulement si aucune adresse n'attend plus de confirmation).
 * Confidentialité, téléchargement de mes données (JSON et page imprimable) et suppression du compte
 * avec un délai de 30 jours : questions 15 à 17, réponses du 24 octobre 2026.
 */
export default async function SettingsPage({ searchParams }: Props) {
  const t = await getTranslations("Member");
  const member = await getSessionMember();
  if (!member) return null;
  const [settings, email, { privacy, deletion }, locale] = await Promise.all([
    loadSettings(member.id),
    loadEmail(),
    loadPrivacyAndDeletion(member.id),
    getLocale(),
  ]);
  const confirmed = (await searchParams).email === "confirme" && !email.pending;

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
      <PrivacyForm initial={privacy} />
      <EmailForm current={email.current} pending={email.pending} confirmed={confirmed} />
      <PhoneForm current={settings.phone} />
      <section id="mes-donnees" aria-labelledby="mes-donnees-titre" className="mt-14 border-t border-line pt-10">
        <h2 id="mes-donnees-titre" className="text-2xl">
          {t("settings.data.title")}
        </h2>
        <p className="mt-3 max-w-measure text-fg-muted">{t("settings.data.help")}</p>
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
          {/* Fichier rendu par une route (pas une page) : lien ordinaire, téléchargement direct */}
          <a href={getPathname({ href: "/espace/mes-donnees/fichier", locale })} download className="text-link underline-offset-4 hover:underline">
            {t("settings.data.json")}
          </a>
          <Link href="/espace/mes-donnees" className="text-link underline-offset-4 hover:underline">
            {t("settings.data.printable")}
          </Link>
        </div>
      </section>
      <DeletionForm deletion={deletion} />
    </div>
  );
}
