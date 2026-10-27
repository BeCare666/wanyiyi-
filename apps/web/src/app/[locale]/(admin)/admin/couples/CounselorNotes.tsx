"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { type AdminCounselorNote, readCounselorNotes } from "./actions";

/**
 * Notes du conseiller sur un couple (question 18) : affichées seulement après confirmation, car
 * chaque lecture est journalisée ; réservées aux litiges et aux signalements.
 */
export function CounselorNotes({ coupleId }: { coupleId: string }) {
  const t = useTranslations("Admin.couples.notes");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<AdminCounselorNote[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = () =>
    startTransition(async () => {
      const result = await readCounselorNotes(coupleId);
      if (!result.ok) return setError(true);
      setError(false);
      setNotes(result.data);
    });

  if (notes) {
    return (
      <div className="mt-2 max-w-xl border-l border-line pl-4">
        {notes.length === 0 ? (
          <p className="text-xs text-fg-muted">{t("empty")}</p>
        ) : (
          <ol className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="text-sm">
                <span className="block text-xs text-fg-muted">
                  {n.counselor_name ?? ""} · {format.dateTime(new Date(n.created_at), { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Porto-Novo" })}
                </span>
                <span className="whitespace-pre-line">{n.body}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-link underline-offset-4 hover:underline">
          {t("show")}
        </button>
      ) : (
        <div className="max-w-xl">
          <p className="text-xs text-fg-muted">{t("warning")}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Button type="button" disabled={pending} onClick={load}>
              {t("confirm")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 border-l border-accent pl-4 text-sm">
          {t("error")}
        </p>
      )}
    </div>
  );
}
