"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { createTheme } from "./actions";
import { checkTheme, type ThemeInput, themeReligions, themeSectors } from "./themes";

const empty: ThemeInput = { name: { fr: "", en: "", yo: "" }, minAge: "", maxAge: "", religions: [], sectors: [] };
const knownErrors = new Set(["name", "age", "criteria", "forbidden", "unavailable"]);
const languages = ["fr", "en", "yo"] as const;

/** Nouveau thème : nom en trois langues (anglais et yoruba reprennent le français s'ils sont vides), critères. */
export function ThemeForm() {
  const t = useTranslations("Admin.themes.form");
  const tp = useTranslations("Profile");
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeInput>(empty);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = (change: Partial<ThemeInput>) => {
    setTheme((th) => ({ ...th, ...change }));
    setSaved(false);
  };
  const toggle = (list: "religions" | "sectors", value: string, on: boolean) =>
    update({ [list]: on ? [...theme[list], value] : theme[list].filter((v) => v !== value) });

  function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = checkTheme(theme);
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const result = await createTheme(theme);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setTheme(empty);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-8">
      <div className="grid gap-8 md:grid-cols-3">
        {languages.map((lang) => (
          <label key={lang} className="block">
            <span className="text-sm font-medium">{t(`name.${lang}`)}</span>
            <input
              lang={lang}
              value={theme.name[lang]}
              onChange={(e) => update({ name: { ...theme.name, [lang]: e.target.value } })}
              maxLength={80}
              className={cn(fieldClass, "text-base")}
            />
          </label>
        ))}
      </div>
      <div className="grid gap-8 sm:grid-cols-2 md:max-w-xl">
        <label className="block">
          <span className="text-sm font-medium">{t("minAge")}</span>
          <input inputMode="numeric" value={theme.minAge} onChange={(e) => update({ minAge: e.target.value })} maxLength={3} className={cn(fieldClass, "text-base")} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("maxAge")}</span>
          <input inputMode="numeric" value={theme.maxAge} onChange={(e) => update({ maxAge: e.target.value })} maxLength={3} className={cn(fieldClass, "text-base")} />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">{t("religions")}</legend>
        <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
          {themeReligions.map((r) => (
            <li key={r}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={theme.religions.includes(r)} onChange={(e) => toggle("religions", r, e.target.checked)} className="size-4 accent-[var(--accent)]" />
                <span>{tp(`religion.${r}`)}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">{t("sectors")}</legend>
        <ul className="mt-3 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          {themeSectors.map((s) => (
            <li key={s}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={theme.sectors.includes(s)} onChange={(e) => toggle("sectors", s, e.target.checked)} className="size-4 accent-[var(--accent)]" />
                <span>{tp(`sector.${s}`)}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <p className="text-sm text-fg-muted">{t("help")}</p>
      {error && (
        <p role="alert" className="border-l border-accent pl-5">
          {t(`errors.${error}`)}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-fg-muted">
          {t("saved")}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
