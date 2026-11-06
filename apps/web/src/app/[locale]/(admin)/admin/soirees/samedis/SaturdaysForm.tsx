"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { scheduleSaturdays } from "../actions";
import type { VenueOption } from "../EventForm";
import { checkSaturdayPlan, type SaturdayPlan } from "../evenings";

const knownErrors = new Set(["venue_required", "starts_at", "invalid_months", "invalid_price", "forbidden", "unavailable"]);

const numberField = cn(fieldClass, "text-base tabular-nums");

/** Formulaire de programmation des samedis : un seul envoi crée toutes les soirées publiées. */
export function SaturdaysForm({ venues, months, priceXof }: { venues: VenueOption[]; months: number; priceXof: number }) {
  const t = useTranslations("Admin.evenings.saturdays");
  const [plan, setPlan] = useState<SaturdayPlan>({ venueId: venues[0]?.id ?? "", firstDay: "", time: "", months, priceXof });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof SaturdayPlan>(key: K, value: SaturdayPlan[K]) => {
    setPlan((p) => ({ ...p, [key]: value }));
    setCreated(null);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = checkSaturdayPlan(plan);
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const result = await scheduleSaturdays(plan);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setCreated(result.data.created);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-8">
      <label className="block">
        <span className="text-sm font-medium">{t("venue")}</span>
        <select value={plan.venueId} onChange={(e) => set("venueId", e.target.value)} className={cn(fieldClass, "text-base")}>
          {venues.length === 0 && <option value="">{t("noVenue")}</option>}
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} · {v.city}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-8 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">{t("firstDay")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("firstDayHelp")}</span>
          <input type="date" required value={plan.firstDay} onChange={(e) => set("firstDay", e.target.value)} className={cn(fieldClass, "text-base")} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("time")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("timeHelp")}</span>
          <input type="time" required value={plan.time} onChange={(e) => set("time", e.target.value)} className={cn(fieldClass, "text-base")} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("months")}</span>
          <input type="number" min={1} max={12} value={plan.months} onChange={(e) => set("months", e.target.valueAsNumber)} className={numberField} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("price")}</span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={Number.isFinite(plan.priceXof) ? plan.priceXof : ""}
            onChange={(e) => set("priceXof", e.target.valueAsNumber)}
            className={numberField}
          />
        </label>
      </div>

      <p className="max-w-measure text-sm text-fg-muted">{t("summary")}</p>

      {error && (
        <p role="alert" className="border-l border-accent pl-5">
          {t(`errors.${error}`)}
        </p>
      )}
      {created !== null && !error && (
        <p role="status" className="border-l border-fg pl-5">
          {t("done", { count: created })}{" "}
          <Link href="/admin/soirees?etat=a-venir" className="text-link underline-offset-4 hover:underline">
            {t("see")}
          </Link>
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending || venues.length === 0}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
