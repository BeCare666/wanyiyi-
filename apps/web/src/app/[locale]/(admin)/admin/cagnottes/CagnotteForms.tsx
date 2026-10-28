"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { markPayoutPaid, saveCagnotteSettings } from "./actions";
import { checkPayout, checkSettings } from "./cagnottes";

const knownErrors = new Set(["invalid_amount", "invalid_commission", "reference_required", "not_pending", "not_found", "forbidden", "unavailable"]);

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setSaved(true);
      router.refresh();
    });
  };
  return { error, setError, saved, pending, run };
}

/** Reversement fait à la main par l'équipe (question 3 e) : montant envoyé et référence. */
export function PayoutForm({ payoutId, maxXof }: { payoutId: string; maxXof: number }) {
  const t = useTranslations("Admin.cagnottes.payout");
  const { error, setError, pending, run } = useSubmit();
  const [sent, setSent] = useState("");
  const [reference, setReference] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const invalid = checkPayout({ sent, reference }, maxXof);
    if (invalid) return setError(invalid);
    run(() => markPayoutPaid(payoutId, sent, reference, maxXof));
  };

  return (
    <form onSubmit={submit} noValidate className="mt-4 grid gap-4 md:grid-cols-3 md:items-end">
      <label className="block">
        <span className="text-sm">{t("sent")}</span>
        <input value={sent} onChange={(e) => setSent(e.target.value)} inputMode="numeric" maxLength={12} className={cn(fieldClass, "text-base")} />
      </label>
      <label className="block">
        <span className="text-sm">{t("reference")}</span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} className={cn(fieldClass, "text-base")} />
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {t("markPaid")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="border-l border-accent pl-4 text-sm md:col-span-3">
          {t(`errors.${error}`)}
        </p>
      )}
    </form>
  );
}

/** Réglages (montants réglables, question 3 c et d) : contribution minimale et commission. */
export function CagnotteSettings({ min, commission }: { min: number; commission: number }) {
  const t = useTranslations("Admin.cagnottes.settings");
  const { error, setError, saved, pending, run } = useSubmit();
  const [minDraft, setMin] = useState(String(min));
  const [commissionDraft, setCommission] = useState(String(commission));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const invalid = checkSettings({ min: minDraft, commission: commissionDraft });
    if (invalid) return setError(invalid);
    run(() => saveCagnotteSettings(minDraft, commissionDraft));
  };

  return (
    <form onSubmit={submit} noValidate className="mt-6 grid gap-6 md:grid-cols-3 md:items-end">
      <label className="block">
        <span className="text-sm font-medium">{t("min")}</span>
        <input value={minDraft} onChange={(e) => setMin(e.target.value)} inputMode="numeric" maxLength={10} className={cn(fieldClass, "text-base")} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t("commission")}</span>
        <input value={commissionDraft} onChange={(e) => setCommission(e.target.value)} inputMode="decimal" maxLength={6} className={cn(fieldClass, "text-base")} />
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
