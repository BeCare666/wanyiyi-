"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { setCounselorPrice } from "./actions";

const knownErrors = new Set(["invalid_price", "forbidden", "unavailable"]);

/**
 * Prix de l'accès au conseiller (règles du 26 octobre 2026) : payé par le membre qui invite,
 * après l'accord de l'autre ; le prix est celui du moment de l'accord. 0 : accès gratuit.
 */
export function CounselorPrice({ current }: { current: number }) {
  const t = useTranslations("Admin.counselors.price");
  const router = useRouter();
  const [price, setPrice] = useState(String(current));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    const value = Number(price.trim());
    if (price.trim() === "" || !Number.isInteger(value) || value < 0 || value > 10_000_000) return setError("invalid_price");
    setError(null);
    startTransition(async () => {
      const result = await setCounselorPrice(value);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setDone(true);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-sm font-medium">{t("label")}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t("help")}</span>
        <input
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={cn(fieldClass, "mt-1 w-48 text-base tabular-nums")}
        />
      </label>
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
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
