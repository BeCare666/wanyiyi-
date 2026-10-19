"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { createVenue } from "./actions";
import { checkVenue, type VenueInput } from "./venues";

const empty: VenueInput = { name: "", address: "", city: "Cotonou", isPartner: false };
const knownErrors = new Set(["name", "address", "city", "forbidden", "unavailable"]);

/** Nouveau lieu de soirée : nom, adresse (communiquée aux seuls confirmés), ville, partenaire. */
export function VenueForm() {
  const t = useTranslations("Admin.venues.form");
  const router = useRouter();
  const [venue, setVenue] = useState<VenueInput>(empty);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof VenueInput>(key: K, value: VenueInput[K]) => {
    setVenue((v) => ({ ...v, [key]: value }));
    setSaved(false);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = checkVenue(venue);
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const result = await createVenue(venue);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setVenue(empty);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-8">
      <div className="grid gap-8 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">{t("name")}</span>
          <input value={venue.name} onChange={(e) => set("name", e.target.value)} maxLength={120} className={cn(fieldClass, "text-base")} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("city")}</span>
          <input value={venue.city} onChange={(e) => set("city", e.target.value)} maxLength={80} className={cn(fieldClass, "text-base")} />
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium">{t("address")}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t("addressHelp")}</span>
        <input value={venue.address} onChange={(e) => set("address", e.target.value)} maxLength={300} className={cn(fieldClass, "text-base")} />
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3">
        <input type="checkbox" checked={venue.isPartner} onChange={(e) => set("isPartner", e.target.checked)} className="size-4 accent-[var(--accent)]" />
        <span>{t("partner")}</span>
      </label>
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
