"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { type Decision, decide } from "./actions";

const decisions: Decision[] = ["approved", "to_correct", "rejected"];
const knownErrors = new Set(["dossier_incomplete", "profile_missing", "note_required", "verification_closed", "forbidden", "unavailable"]);

/**
 * Décision de l'équipe : valider, demander une correction (message obligatoire, lu par le membre)
 * ou refuser (seconde confirmation : le membre est exclu).
 */
export function DecisionForm({ verificationId, ready }: { verificationId: string; ready: boolean }) {
  const t = useTranslations("Admin.verifications.decision");
  const router = useRouter();
  const [choice, setChoice] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!choice) return setError("choose");
    if (choice === "to_correct" && note.trim() === "") return setError("note_required");
    if (choice === "rejected" && !confirmReject) return setConfirmReject(true);
    setError(null);
    startTransition(async () => {
      const result = await decide(verificationId, choice, note);
      setConfirmReject(false);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <fieldset>
        <legend className="sr-only">{t("title")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {decisions.map((value) => {
            const disabled = value === "approved" && !ready;
            return (
              <label
                key={value}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-sm border px-4",
                  choice === value ? "border-fg bg-bg-soft" : "border-line",
                  disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                )}
              >
                <input
                  type="radio"
                  name="decision"
                  disabled={disabled}
                  checked={choice === value}
                  onChange={() => {
                    setChoice(value);
                    setConfirmReject(false);
                    setError(null);
                  }}
                  className="size-4 accent-[var(--accent)]"
                />
                <span>{t(`choices.${value}`)}</span>
              </label>
            );
          })}
        </div>
        {!ready && <p className="mt-3 text-sm text-fg-muted">{t("notReady")}</p>}
        {/* Photos approuvées avec le dossier et membre prévenu (30 octobre 2026) */}
        {choice === "approved" && <p className="mt-3 text-sm text-fg-muted">{t("approvedEffect")}</p>}
      </fieldset>

      {choice && choice !== "approved" && (
        <label className="mt-6 block">
          <span className="text-sm font-medium">{t(choice === "to_correct" ? "noteLabel" : "noteOptional")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("noteHelp")}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} className={cn(fieldClass, "resize-y text-base")} />
        </label>
      )}

      {confirmReject && (
        <p role="alert" className="mt-6 border-l border-accent pl-5">
          {t("confirmReject")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-6 border-l border-accent pl-5">
          {t(`errors.${error}`)}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-8">
        {confirmReject ? t("confirmRejectButton") : t("submit")}
      </Button>
    </form>
  );
}
