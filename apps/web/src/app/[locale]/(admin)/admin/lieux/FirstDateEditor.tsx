"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { updateFirstDate } from "./actions";
import { checkFirstDate, type FirstDateInput, type FirstDateRow, venueKinds } from "./venues";

const knownErrors = new Set(["district", "kind", "hours", "forbidden", "unavailable"]);

/** Réglage d'un lieu conseillé pour un premier rendez-vous (question 4). */
export function FirstDateEditor({ venue }: { venue: FirstDateRow }) {
  const t = useTranslations("Admin.venues.firstDate");
  const router = useRouter();
  const [input, setInput] = useState<FirstDateInput>({
    partner: venue.first_date_partner,
    district: venue.district ?? "",
    kind: venue.venue_kind ?? "",
    hours: venue.opening_hours ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof FirstDateInput>(key: K, value: FirstDateInput[K]) => {
    setInput((v) => ({ ...v, [key]: value }));
    setSaved(false);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = checkFirstDate(input);
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const result = await updateFirstDate(venue.id, input);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 border-b border-line py-6 md:grid-cols-12 md:items-end">
      <div className="md:col-span-3">
        <p className="font-medium">{venue.name}</p>
        <p className="text-sm text-fg-muted">{venue.city}</p>
        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" checked={input.partner} onChange={(e) => set("partner", e.target.checked)} className="size-4 accent-[var(--accent)]" />
          <span>{t("partner")}</span>
        </label>
      </div>
      <label className="block md:col-span-3">
        <span className="text-sm font-medium">{t("district")}</span>
        <input value={input.district} onChange={(e) => set("district", e.target.value)} maxLength={80} className={cn(fieldClass, "text-base")} />
      </label>
      <label className="block md:col-span-2">
        <span className="text-sm font-medium">{t("kind")}</span>
        <select value={input.kind} onChange={(e) => set("kind", e.target.value as FirstDateInput["kind"])} className={cn(fieldClass, "text-base")}>
          <option value="">{t("noKind")}</option>
          {venueKinds.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block md:col-span-2">
        <span className="text-sm font-medium">{t("hours")}</span>
        <input value={input.hours} onChange={(e) => set("hours", e.target.value)} maxLength={120} placeholder={t("hoursPlaceholder")} className={cn(fieldClass, "text-base")} />
      </label>
      <div className="md:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {t("save")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="border-l border-accent pl-4 text-sm md:col-span-12">
          {t(`errors.${error}`)}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-fg-muted md:col-span-12">
          {t("saved")}
        </p>
      )}
    </form>
  );
}
