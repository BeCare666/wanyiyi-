import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { DeleteTheme } from "./DeleteTheme";
import { ThemeForm } from "./ThemeForm";
import { themeName, type ThemeRow } from "./themes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("themes") };
}

/** Thèmes des soirées (questions 4 et 21, choix du 24 octobre 2026) : liste, création, suppression. */
export default async function AdminThemesPage() {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const t = await getTranslations("Admin");
  const tp = await getTranslations("Profile");
  const locale = await getLocale();
  const supabase = await createSupabaseServer();
  const result = supabase
    ? await supabase.from("themes").select("id, key, name, min_age, max_age, required_religions, sectors").order("created_at")
    : null;
  const themes = (result?.data as ThemeRow[] | null) ?? [];

  const criteria = (th: ThemeRow): string[] => [
    ...(th.min_age !== null || th.max_age !== null
      ? [
          th.min_age !== null && th.max_age !== null
            ? t("themes.ageRange", { min: th.min_age, max: th.max_age })
            : th.min_age !== null
              ? t("themes.ageMin", { min: th.min_age })
              : t("themes.ageMax", { max: th.max_age ?? 0 }),
        ]
      : []),
    ...(th.required_religions ?? []).map((r) => (tp.has(`religion.${r}`) ? tp(`religion.${r}`) : r)),
    ...(th.sectors ?? []).map((s) => (tp.has(`sector.${s}`) ? tp(`sector.${s}`) : s)),
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.evenings")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.themes")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("themes.intro")}</p>
      </header>

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : themes.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("themes.empty")}</p>
      ) : (
        <ul className="mt-10 border-t border-line-strong">
          {themes.map((th) => (
            <li key={th.id} className="grid gap-2 border-b border-line py-4 md:grid-cols-12 md:items-baseline md:gap-6">
              <p className="font-medium md:col-span-4">{themeName(th, locale)}</p>
              <p className="text-sm text-fg-muted md:col-span-6">{criteria(th).join(" · ")}</p>
              <div className="md:col-span-2 md:text-right">
                <DeleteTheme id={th.id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="new-theme" className="mt-12 border-t border-line pt-8">
        <h2 id="new-theme" className="text-2xl">{t("themes.new")}</h2>
        <div className="mt-6">
          <ThemeForm />
        </div>
      </section>
    </div>
  );
}
