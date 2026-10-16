"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Flag } from "@/components/brand/Flag";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";
import { saveChannel, saveDarkMode, saveLocale } from "./actions";
import { type NotificationChannel, notificationChannels, type Settings } from "./settings";

type Status = { section: "language" | "display" | "notifications"; ok: boolean } | null;

/**
 * Paramètres enregistrés dès qu'ils changent, sans bouton « Enregistrer ».
 * La langue choisie est mémorisée sur le profil, puis la page s'ouvre dans cette langue.
 */
export function SettingsForm({ initial }: { initial: Settings }) {
  const t = useTranslations("Member.settings");
  const tl = useTranslations("Language");
  const router = useRouter();
  const pathname = usePathname();
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();

  function chooseLocale(locale: Settings["locale"]) {
    if (locale === settings.locale) return;
    setStatus(null);
    startTransition(async () => {
      if (!(await saveLocale(locale))) return setStatus({ section: "language", ok: false });
      setSettings((s) => ({ ...s, locale }));
      router.replace(pathname, { locale });
    });
  }

  function toggleDarkMode(darkMode: boolean) {
    setStatus(null);
    setSettings((s) => ({ ...s, darkMode }));
    startTransition(async () => {
      const ok = await saveDarkMode(darkMode);
      if (!ok) setSettings((s) => ({ ...s, darkMode: !darkMode }));
      setStatus({ section: "display", ok });
      // Le thème de l'espace membre est appliqué par la mise en page (serveur)
      if (ok) router.refresh();
    });
  }

  function toggleChannel(channel: NotificationChannel, enabled: boolean) {
    setStatus(null);
    setSettings((s) => ({ ...s, channels: { ...s.channels, [channel]: enabled } }));
    startTransition(async () => {
      const ok = await saveChannel(channel, enabled);
      if (!ok) setSettings((s) => ({ ...s, channels: { ...s.channels, [channel]: !enabled } }));
      setStatus({ section: "notifications", ok });
    });
  }

  const feedback = (section: NonNullable<Status>["section"]) =>
    status?.section === section && (
      <p role={status.ok ? "status" : "alert"} className={cn("mt-4 border-l pl-4 text-sm", status.ok ? "border-fg" : "border-accent")}>
        {t(status.ok ? "saved" : "error")}
      </p>
    );

  return (
    <div className="mt-14 border-t border-line">
      <section aria-labelledby="parametres-langue" className="grid gap-4 border-b border-line py-8 md:grid-cols-12 md:gap-8">
        <h2 id="parametres-langue" className="eyebrow md:col-span-4">
          {t("language")}
        </h2>
        <div className="md:col-span-8">
          <ul className="grid grid-cols-3 gap-2">
            {routing.locales.map((l) => {
              const current = l === settings.locale;
              return (
                <li key={l}>
                  <button
                    type="button"
                    lang={l}
                    aria-pressed={current}
                    disabled={pending}
                    onClick={() => chooseLocale(l)}
                    className={cn(
                      "flex min-h-12 w-full items-center justify-center gap-2.5 rounded-sm border px-2 text-sm disabled:opacity-50",
                      current ? "border-fg text-fg" : "border-line text-fg-muted",
                    )}
                  >
                    <Flag locale={l} />
                    {tl(l)}
                  </button>
                </li>
              );
            })}
          </ul>
          {feedback("language")}
        </div>
      </section>

      <section aria-labelledby="parametres-affichage" className="grid gap-4 border-b border-line py-8 md:grid-cols-12 md:gap-8">
        <h2 id="parametres-affichage" className="eyebrow md:col-span-4">
          {t("display")}
        </h2>
        <div className="md:col-span-8">
          <label className="flex min-h-12 cursor-pointer items-center justify-between gap-6">
            <span>{t("darkMode")}</span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.darkMode}
              onChange={(e) => toggleDarkMode(e.target.checked)}
              className="size-5 accent-[var(--accent)]"
            />
          </label>
          {feedback("display")}
        </div>
      </section>

      <section aria-labelledby="parametres-notifications" className="grid gap-4 border-b border-line py-8 md:grid-cols-12 md:gap-8">
        <h2 id="parametres-notifications" className="eyebrow md:col-span-4">
          {t("notifications")}
        </h2>
        <div className="md:col-span-8">
          <p className="text-sm text-fg-muted">{t("notificationsHelp")}</p>
          <ul className="mt-4">
            {notificationChannels.map((channel) => (
              <li key={channel} className="border-b border-line last:border-b-0">
                <label className="flex min-h-12 cursor-pointer items-center justify-between gap-6">
                  <span>{t(`channels.${channel}`)}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={settings.channels[channel]}
                    onChange={(e) => toggleChannel(channel, e.target.checked)}
                    className="size-5 accent-[var(--accent)]"
                  />
                </label>
              </li>
            ))}
          </ul>
          {feedback("notifications")}
        </div>
      </section>
    </div>
  );
}
