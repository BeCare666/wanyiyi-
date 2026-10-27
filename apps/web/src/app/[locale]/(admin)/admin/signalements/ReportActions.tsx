"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { loadReportedMessages, type ReportedMessage, resolveReport } from "./actions";
import { type Decision, decisions } from "./reports";

const knownErrors = new Set(["reason_required", "reason_too_long", "already_resolved", "not_found", "forbidden", "invalid_status", "unavailable"]);

/** Messages signalés : affichés seulement à la demande, car chaque consultation est journalisée. */
export function ReportedMessages({ reportId }: { reportId: string }) {
  const t = useTranslations("Admin.reports");
  const format = useFormatter();
  const [messages, setMessages] = useState<ReportedMessage[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  if (messages) {
    return messages.length === 0 ? (
      <p className="mt-3 text-sm text-fg-muted">{t("noMessages")}</p>
    ) : (
      <ol className="mt-3 space-y-3 border-l border-line pl-4">
        {messages.map((m) => (
          <li key={m.id} className="text-sm">
            <span className="block text-xs text-fg-muted">
              {m.sender_first_name ?? ""} · {format.dateTime(new Date(m.created_at), { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Porto-Novo" })}
            </span>
            <span className="whitespace-pre-line">{m.body}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await loadReportedMessages(reportId);
            if (!result.ok) return setError(true);
            setMessages(result.data);
          })
        }
        className="min-h-11 text-sm text-link underline-offset-4 hover:underline"
      >
        {t("showMessages")}
      </button>
      <p className="text-xs text-fg-muted">{t("logged")}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {t("errors.generic")}
        </p>
      )}
    </div>
  );
}

/** Décision sur un signalement, avec un motif neutre notifié à la personne signalée. */
export function ReportDecision({ reportId }: { reportId: string }) {
  const t = useTranslations("Admin.reports");
  const router = useRouter();
  const [decision, setDecision] = useState<Decision>("dismissed");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (decision !== "dismissed" && reason.trim() === "") return setError("reason_required");
    setError(null);
    startTransition(async () => {
      const result = await resolveReport(reportId, decision, reason);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="mt-4 grid max-w-xl gap-3">
      <label className="block">
        <span className="text-sm font-medium">{t("decision")}</span>
        <select value={decision} onChange={(e) => setDecision(e.target.value as Decision)} className={cn(fieldClass, "text-base")}>
          {decisions.map((d) => (
            <option key={d} value={d}>
              {t(`decisions.${d}`)}
            </option>
          ))}
        </select>
      </label>
      {decision !== "dismissed" && (
        <label className="block">
          <span className="text-sm font-medium">{t("reason")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("reasonHelp")}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} className={cn(fieldClass, "resize-y text-base")} />
        </label>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {t("confirm")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="border-l border-accent pl-4 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </form>
  );
}
