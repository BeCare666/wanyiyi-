"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { markRefunded } from "./actions";

const knownErrors = new Set(["not_refundable", "forbidden", "unavailable"]);

/**
 * « Marquer remboursé », une fois le remboursement fait dans le tableau de bord FeexPay
 * (décision du 22 octobre 2026). Seconde confirmation : l'action ne s'annule pas.
 */
export function RefundButton({ paymentId }: { paymentId: string }) {
  const t = useTranslations("Admin.payments.markRefunded");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function click() {
    setError(null);
    if (!confirming) return setConfirming(true);
    startTransition(async () => {
      const result = await markRefunded(paymentId);
      setConfirming(false);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  }

  return (
    <span className="mt-2 block">
      {confirming && <span className="block text-xs text-fg-muted">{t("confirm")}</span>}
      {error && (
        <span role="alert" className="block text-xs">
          {t(`errors.${error}`)}
        </span>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={click}
        className="mt-1 text-xs text-link underline underline-offset-4 disabled:opacity-60"
      >
        {confirming ? t("confirmButton") : t("button")}
      </button>
    </span>
  );
}
