"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { reviewPhoto, reviewText } from "./actions";

const knownErrors = new Set(["note_required", "note_too_long", "already_reviewed", "not_found", "forbidden", "unavailable"]);

/**
 * Approuver un texte ou une photo, ou le refuser avec un motif écrit (obligatoire), que le membre
 * lit dans sa notification. Le texte refusé reste masqué jusqu'à ce que le membre le réécrive ;
 * la photo refusée n'est jamais montrée et libère une place (phase 3, question 10).
 */
export function TextReview({ textId, kind = "text" }: { textId: string; kind?: "text" | "photo" }) {
  const t = useTranslations("Admin.moderation");
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const result = await (kind === "photo" ? reviewPhoto : reviewText)(textId, decision, note);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  }

  function reject(e: FormEvent) {
    e.preventDefault();
    if (note.trim() === "") return setError("note_required");
    run("rejected");
  }

  return (
    <div className="mt-4">
      {error && (
        <p role="alert" className="mb-4 border-l border-accent pl-5 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
      {rejecting ? (
        <form onSubmit={reject} noValidate>
          <label className="block">
            <span className="text-sm font-medium">{t("reason")}</span>
            <span className="mt-1 block text-xs text-fg-muted">{t("reasonHelp")}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className={cn(fieldClass, "resize-y text-base")} />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {t("confirmReject")}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setRejecting(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={pending} onClick={() => run("approved")}>
            {t("approve")}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setRejecting(true)}>
            {t("reject")}
          </Button>
        </div>
      )}
    </div>
  );
}
