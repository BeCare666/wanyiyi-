"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import type { ApiResult } from "@/lib/api";
import { cn } from "@/lib/cn";

/** Motifs de signalement (question 11, 27 octobre 2026). */
export const reportReasons = ["disrespect", "money", "fake_profile", "sexual", "threat", "other"] as const;
export type ReportReason = (typeof reportReasons)[number];

const knownErrors = new Set(["details_required", "details_too_long", "invalid_reason", "invalid_message", "not_member", "unavailable"]);

/**
 * Signalement d'un message ou d'une conversation : motif, précisions (obligatoires pour « autre »).
 * La personne signalée n'est pas prévenue ; « menace ou danger » met la conversation en lecture
 * seule tout de suite.
 */
export function ReportForm({
  onSubmit,
  onClose,
}: {
  onSubmit: (reason: ReportReason, details: string) => Promise<ApiResult<string>>;
  onClose: () => void;
}) {
  const t = useTranslations("Member.report");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return setError("invalid_reason");
    if (reason === "other" && details.trim() === "") return setError("details_required");
    setError(null);
    startTransition(async () => {
      const result = await onSubmit(reason, details.trim());
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setDone(true);
    });
  };

  if (done) {
    return (
      <div role="status" className="mt-3 max-w-xl border-l border-accent pl-4 text-sm">
        <p>{t(reason === "threat" ? "sentThreat" : "sent")}</p>
        <button type="button" onClick={onClose} className="mt-2 min-h-11 text-link underline-offset-4 hover:underline">
          {t("close")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 max-w-xl border-l border-accent pl-4 text-left text-sm">
      <fieldset>
        <legend className="font-medium">{t("why")}</legend>
        <div className="mt-2 grid gap-1">
          {reportReasons.map((r) => (
            <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-[var(--accent)]" />
              <span>{t(`reasons.${r}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-3 block">
        <span>{t(reason === "other" ? "detailsRequired" : "details")}</span>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} maxLength={1000} className={cn(fieldClass, "resize-y text-base")} />
      </label>
      <p className="mt-2 text-xs text-fg-muted">{t("private")}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {t("submit")}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </form>
  );
}
