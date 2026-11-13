"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { setCounselPricing } from "./actions";

const knownErrors = new Set(["invalid_price", "invalid_free_messages", "forbidden", "unavailable"]);

/**
 * Conseiller sollicité seul (10 novembre 2026) : messages gratuits (une seule fois par membre),
 * puis prix de chaque message du membre. Réponses du conseiller gratuites. Prix 0 : tout gratuit.
 */
export function CounselPricing({ price: currentPrice, free: currentFree }: { price: number; free: number }) {
  const t = useTranslations("Admin.counselors.solo.pricing");
  const router = useRouter();
  const [price, setPrice] = useState(String(currentPrice));
  const [free, setFree] = useState(String(currentFree));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    const p = Number(price.trim());
    const f = Number(free.trim());
    if (price.trim() === "" || !Number.isInteger(p) || p < 0 || p > 100_000) return setError("invalid_price");
    if (free.trim() === "" || !Number.isInteger(f) || f < 0 || f > 100) return setError("invalid_free_messages");
    setError(null);
    startTransition(async () => {
      const result = await setCounselPricing(p, f);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setDone(true);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-sm font-medium">{t("free")}</span>
        <input inputMode="numeric" value={free} onChange={(e) => setFree(e.target.value)} className={cn(fieldClass, "mt-1 w-32 text-base tabular-nums")} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t("price")}</span>
        <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className={cn(fieldClass, "mt-1 w-40 text-base tabular-nums")} />
      </label>
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
      <p className="w-full text-xs text-fg-muted">{t("help")}</p>
      {error && (
        <p role="alert" className="w-full border-l border-accent pl-4 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
      {done && (
        <p role="status" className="w-full text-sm text-fg-muted">
          {t("saved")}
        </p>
      )}
    </form>
  );
}
