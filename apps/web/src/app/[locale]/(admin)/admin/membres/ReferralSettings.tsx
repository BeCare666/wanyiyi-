"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { saveReferralSettings } from "./actions";

const knownErrors = new Set(["invalid_amount", "invalid_limit", "forbidden", "unavailable"]);

/** Réglages du parrainage (phase 4, question 4 d) : réduction offerte au parrain et plafond annuel. */
export function ReferralSettings({ reward, max }: { reward: number; max: number }) {
  const t = useTranslations("Admin.members.referral.settings");
  const router = useRouter();
  const [rewardDraft, setReward] = useState(String(reward));
  const [maxDraft, setMax] = useState(String(max));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveReferralSettings(rewardDraft, maxDraft);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="mt-6 grid gap-6 md:grid-cols-3 md:items-end">
      <label className="block">
        <span className="text-sm font-medium">{t("reward")}</span>
        <input value={rewardDraft} onChange={(e) => setReward(e.target.value)} inputMode="numeric" maxLength={9} className={cn(fieldClass, "text-base")} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t("max")}</span>
        <input value={maxDraft} onChange={(e) => setMax(e.target.value)} inputMode="numeric" maxLength={3} className={cn(fieldClass, "text-base")} />
      </label>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t("save")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="border-l border-accent pl-4 text-sm md:col-span-3">
          {t(`errors.${error}`)}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-fg-muted md:col-span-3">
          {t("saved")}
        </p>
      )}
    </form>
  );
}
