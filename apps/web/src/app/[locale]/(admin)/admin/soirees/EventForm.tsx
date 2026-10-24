"use client";

import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { type ThemeName, themeName } from "@/lib/theme-name";
import { saveEvent } from "./actions";
import { checkDraft, type EventDraft } from "./evenings";

export type VenueOption = { id: string; name: string; city: string };
export type ThemeOption = { id: string; key: string; name: Partial<ThemeName> | null; min_age: number | null; max_age: number | null };

const knownErrors = new Set([
  "starts_at",
  "starts_in_past",
  "invalid_capacity",
  "invalid_duration",
  "invalid_price",
  "venue_not_found",
  "theme_not_found",
  "not_editable",
  "venue_required",
  "capacity_below_taken",
  "forbidden",
  "unavailable",
]);

const numberField = cn(fieldClass, "text-base tabular-nums");

/**
 * Création ou modification d'une soirée, brouillon ou publiée (11.2-5). Heure saisie à l'heure de Cotonou.
 * Le tarif peut rester vide : les membres lisent alors « Tarif communiqué prochainement ».
 */
export function EventForm({
  eventId,
  published = false,
  initial,
  venues,
  themes,
}: {
  eventId: string | null;
  /** Soirée déjà publiée : chaque enregistrement est notifié aux inscrits (décision du 19 octobre 2026). */
  published?: boolean;
  initial: EventDraft;
  venues: VenueOption[];
  themes: ThemeOption[];
}) {
  const t = useTranslations("Admin.evenings.form");
  const locale = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState<EventDraft>(initial);
  const [price, setPrice] = useState(initial.priceXof === null ? "" : String(initial.priceXof));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    const priceXof = price.trim() === "" ? null : Number(price);
    const values = { ...draft, priceXof: priceXof !== null && Number.isFinite(priceXof) ? priceXof : -1 };
    const invalid = checkDraft(values, new Date());
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const result = await saveEvent(eventId, values);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      if (eventId === null) return router.push(`/admin/soirees/${result.data.id}`);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-8">
      <div className="grid gap-8 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">{t("startsAt")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("startsAtHelp")}</span>
          <input
            type="datetime-local"
            required
            value={draft.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
            className={cn(fieldClass, "text-base")}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("venue")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("venueHelp")}</span>
          <select value={draft.venueId ?? ""} onChange={(e) => set("venueId", e.target.value || null)} className={cn(fieldClass, "text-base")}>
            <option value="">{t("noVenue")}</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.city}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">{t("theme")}</span>
        <select value={draft.themeId ?? ""} onChange={(e) => set("themeId", e.target.value || null)} className={cn(fieldClass, "text-base")}>
          <option value="">{t("noTheme")}</option>
          {themes.map((th) => (
            <option key={th.id} value={th.id}>
              {themeName(th, locale)}
              {th.min_age !== null && ` · ${t("themeMin", { min: th.min_age })}`}
              {th.max_age !== null && ` · ${t("themeMax", { max: th.max_age })}`}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-4 text-sm font-medium">{t("format")}</legend>
        <label className="block">
          <span className="text-sm">{t("capacityWomen")}</span>
          <input type="number" min={1} max={12} value={draft.capacityWomen} onChange={(e) => set("capacityWomen", e.target.valueAsNumber)} className={numberField} />
        </label>
        <label className="block">
          <span className="text-sm">{t("capacityMen")}</span>
          <input type="number" min={1} max={12} value={draft.capacityMen} onChange={(e) => set("capacityMen", e.target.valueAsNumber)} className={numberField} />
        </label>
        <label className="block">
          <span className="text-sm">{t("roundMinutes")}</span>
          <input type="number" min={1} value={draft.roundMinutes} onChange={(e) => set("roundMinutes", e.target.valueAsNumber)} className={numberField} />
        </label>
        <label className="block">
          <span className="text-sm">{t("changeoverMinutes")}</span>
          <input type="number" min={0} value={draft.changeoverMinutes} onChange={(e) => set("changeoverMinutes", e.target.valueAsNumber)} className={numberField} />
        </label>
      </fieldset>

      <label className="block max-w-xs">
        <span className="text-sm font-medium">{t("price")}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t("priceHelp")}</span>
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
            setSaved(false);
          }}
          className={numberField}
        />
      </label>

      {published && <p className="text-sm text-fg-muted">{t("publishedHelp")}</p>}
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
          {t(eventId === null ? "create" : "save")}
        </Button>
      </div>
    </form>
  );
}
