"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { bulkInvite, bulkNotify } from "./actions";
import { BULK_FIELD, BULK_FORM, type BulkMessage, bulkLocales, type BulkTarget, MAX_FILTERED, MAX_SELECTED, MESSAGE_MAX } from "./bulk";
import type { FilterNode } from "./filters";

export type InvitableEvening = { id: string; startsAt: string; venue: string | null; full: boolean };

const knownErrors = new Set(["invalid_targets", "invalid_message", "not_invitable", "not_found", "forbidden", "unavailable"]);

/** Identifiants cochés dans le tableau. */
function checkedIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM}"][name="${BULK_FIELD}"]:checked`)).map((i) => i.value);
}

/** Case « tout cocher » de l'en-tête du tableau (page affichée seulement). */
export function SelectAll({ label }: { label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM}"][name="${BULK_FIELD}"]`).forEach((input) => {
          input.checked = e.target.checked;
        });
        document.dispatchEvent(new Event("selection-membres"));
      }}
    />
  );
}

/**
 * Actions groupées (section 11.3, décisions du 19 octobre 2026) : envoyer une notification écrite
 * en trois langues, ou inviter à une soirée (notification avec lien ; le membre réserve lui-même).
 * Cible : les membres cochés, ou tout le résultat du filtre affiché. Seconde confirmation.
 */
export function BulkActions({ filter, total, evenings }: { filter: FilterNode; total: number; evenings: InvitableEvening[] }) {
  const t = useTranslations("Admin.members.bulk");
  const format = useFormatter();
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<"selected" | "filter">("selected");
  const [action, setAction] = useState<"notify" | "invite">("notify");
  const [message, setMessage] = useState<BulkMessage>({ fr: "", en: "", yo: "" });
  const [eventId, setEventId] = useState(evenings[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Sélection lue dans le tableau à chaque case cochée ou décochée
  useEffect(() => {
    const refresh = () => setSelected(checkedIds());
    const onChange = (e: Event) => {
      const input = e.target as HTMLInputElement | null;
      if (input?.getAttribute("form") === BULK_FORM) refresh();
    };
    refresh();
    document.addEventListener("change", onChange);
    document.addEventListener("selection-membres", refresh);
    return () => {
      document.removeEventListener("change", onChange);
      document.removeEventListener("selection-membres", refresh);
    };
  }, []);

  const recipients = scope === "selected" ? selected.length : Math.min(total, MAX_FILTERED);
  const target: BulkTarget = scope === "selected" ? { kind: "selected", ids: selected } : { kind: "filter", filter };
  const tooMany = scope === "selected" && selected.length > MAX_SELECTED;
  const ready =
    recipients > 0 && !tooMany && (action === "notify" ? bulkLocales.every((l) => message[l].trim() !== "") : eventId !== "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!ready) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    startTransition(async () => {
      if (action === "notify") {
        const result = await bulkNotify(target, message);
        if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
        setDone(t("notified", { count: result.data.recipients }));
        setMessage({ fr: "", en: "", yo: "" });
      } else {
        const result = await bulkInvite(target, eventId);
        if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
        setDone(t("invited", { count: result.data.invited, skipped: result.data.skipped }));
      }
    });
  };

  const eveningLabel = (e: InvitableEvening) =>
    [format.dateTime(new Date(e.startsAt), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }), e.venue, e.full ? t("full") : null]
      .filter(Boolean)
      .join(" · ");

  return (
    <details className="mt-8 border-t border-line pt-6">
      <summary className="cursor-pointer text-sm font-medium">{t("title")}</summary>
      <form id={BULK_FORM} onSubmit={submit} className="mt-6 space-y-8">
        <fieldset>
          <legend className="text-sm font-medium">{t("target")}</legend>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="cible" checked={scope === "selected"} onChange={() => setScope("selected")} />
              {t("selected", { count: selected.length })}
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="cible" checked={scope === "filter"} onChange={() => setScope("filter")} />
              {t("filtered", { count: Math.min(total, MAX_FILTERED) })}
            </label>
          </div>
          {tooMany && <p className="mt-2 text-xs text-fg-muted">{t("tooMany", { max: MAX_SELECTED })}</p>}
          {scope === "filter" && total > MAX_FILTERED && <p className="mt-2 text-xs text-fg-muted">{t("filterLimit", { max: MAX_FILTERED })}</p>}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">{t("action")}</legend>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="action" checked={action === "notify"} onChange={() => setAction("notify")} />
              {t("notify")}
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="action" checked={action === "invite"} onChange={() => setAction("invite")} />
              {t("invite")}
            </label>
          </div>
        </fieldset>

        {action === "notify" ? (
          <fieldset className="space-y-6">
            <legend className="text-sm font-medium">{t("message")}</legend>
            <p className="text-xs text-fg-muted">{t("messageHelp")}</p>
            {bulkLocales.map((l) => (
              <label key={l} className="block">
                <span className="text-sm">{t(`languages.${l}`)}</span>
                <textarea
                  value={message[l]}
                  maxLength={MESSAGE_MAX}
                  rows={3}
                  lang={l}
                  onChange={(e) => setMessage((m) => ({ ...m, [l]: e.target.value }))}
                  className={cn(fieldClass, "mt-1 resize-y text-base")}
                />
                <span className="mt-1 block text-right text-xs tabular-nums text-fg-muted">
                  {message[l].length} / {MESSAGE_MAX}
                </span>
              </label>
            ))}
          </fieldset>
        ) : evenings.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("noEvening")}</p>
        ) : (
          <label className="block">
            <span className="text-sm font-medium">{t("evening")}</span>
            <span className="mt-1 block text-xs text-fg-muted">{t("eveningHelp")}</span>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={cn(fieldClass, "mt-1 text-base")}>
              {evenings.map((e) => (
                <option key={e.id} value={e.id}>
                  {eveningLabel(e)}
                </option>
              ))}
            </select>
          </label>
        )}

        {confirming && (
          <p role="alert" className="border-l border-accent pl-5">
            {t(action === "notify" ? "confirmNotify" : "confirmInvite", { count: recipients })}
          </p>
        )}
        {error && (
          <p role="alert" className="border-l border-accent pl-5">
            {t(`errors.${error}`)}
          </p>
        )}
        {done && (
          <p role="status" className="text-sm text-fg-muted">
            {done}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!ready || pending}>
            {confirming ? t("confirmButton") : t(action === "notify" ? "sendNotify" : "sendInvite")}
          </Button>
          {confirming && (
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
          )}
        </div>
      </form>
    </details>
  );
}
