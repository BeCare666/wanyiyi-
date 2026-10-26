"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { blockCouple, unblockCouple } from "./actions";

const knownErrors = new Set(["reason_required", "reason_too_long", "already_blocked", "not_blocked", "not_found", "forbidden", "unavailable"]);

/** Bloquer un couple avec un motif écrit (notifié aux deux), ou lever le blocage, avec confirmation. */
export function CoupleBlock({ coupleId, blocked }: { coupleId: string; blocked: boolean }) {
  const t = useTranslations("Admin.couples.block");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setOpen(false);
      setReason("");
      router.refresh();
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim() === "") return setError("reason_required");
    run(() => blockCouple(coupleId, reason));
  };

  return (
    <div className="mt-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-link underline-offset-4 hover:underline">
          {blocked ? t("unblock") : t("block")}
        </button>
      ) : blocked ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={pending} onClick={() => run(() => unblockCouple(coupleId))}>
            {t("confirmUnblock")}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <label className="block">
            <span className="text-sm font-medium">{t("reason")}</span>
            <span className="mt-1 block text-xs text-fg-muted">{t("reasonHelp")}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} className={cn(fieldClass, "resize-y text-base")} />
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {t("confirmBlock")}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 border-l border-accent pl-4 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
