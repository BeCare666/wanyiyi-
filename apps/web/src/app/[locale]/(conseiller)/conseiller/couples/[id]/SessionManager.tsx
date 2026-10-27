"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import type { SessionRow } from "@/app/[locale]/(membre)/espace/couple/couple";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import type { ApiResult } from "@/lib/api";
import { cn } from "@/lib/cn";
import { cancelSession, completeSession, proposeSession } from "../../actions";

const knownErrors = new Set(["invalid_date", "invalid_mode", "location_required", "location_too_long", "not_counselor", "invalid_status", "unavailable"]);

/**
 * Séances du couple (question 9) : proposer une date (en ligne ou dans un lieu), annuler, marquer
 * « faite » une séance confirmée dont l'heure est passée.
 */
export function SessionManager({ coupleId, sessions }: { coupleId: string; sessions: SessionRow[] }) {
  const t = useTranslations("Counselor.sessions");
  const tm = useTranslations("Member.couple.sessions");
  const format = useFormatter();
  const router = useRouter();
  const [when, setWhen] = useState("");
  const [mode, setMode] = useState<"online" | "place">("online");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ApiResult<unknown>>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      after?.();
      router.refresh();
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (when === "") return setError("invalid_date");
    if (mode === "place" && location.trim() === "") return setError("location_required");
    run(
      () => proposeSession(coupleId, when, mode, location),
      () => {
        setWhen("");
        setLocation("");
      },
    );
  };
  const now = Date.now();

  return (
    <div>
      {sessions.length > 0 && (
        <ol className="mt-4 border-t border-line">
          {sessions.map((s) => (
            <li key={s.id} className="grid gap-2 border-b border-line py-4 md:grid-cols-12 md:items-center md:gap-6">
              <p className="md:col-span-5">
                {format.dateTime(new Date(s.scheduled_at), { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Porto-Novo" })}
                <span className="block text-sm text-fg-muted">{s.mode === "online" ? tm("online") : tm("place", { place: s.location ?? "" })}</span>
              </p>
              <p className="text-sm md:col-span-3">{tm(`status.${s.status}`)}</p>
              <div className="flex flex-wrap gap-3 text-sm md:col-span-4 md:justify-end">
                {s.status === "confirmed" && new Date(s.scheduled_at).getTime() <= now && (
                  <Button type="button" disabled={pending} onClick={() => run(() => completeSession(s.id))}>
                    {t("done")}
                  </Button>
                )}
                {(s.status === "proposed" || s.status === "confirmed") && (
                  <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => cancelSession(s.id))}>
                    {t("cancel")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={submit} noValidate className="mt-6 grid max-w-2xl gap-4">
        <p className="font-medium">{t("propose")}</p>
        <label className="block">
          <span className="text-sm">{t("when")}</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={cn(fieldClass, "mt-2")} />
        </label>
        <fieldset className="flex flex-wrap gap-6">
          <legend className="text-sm">{t("mode")}</legend>
          {(["online", "place"] as const).map((m) => (
            <label key={m} className="mt-2 flex min-h-11 cursor-pointer items-center gap-3">
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} className="size-4 accent-[var(--accent)]" />
              <span>{t(`modes.${m}`)}</span>
            </label>
          ))}
        </fieldset>
        {mode === "place" && (
          <label className="block">
            <span className="text-sm">{t("location")}</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} className={cn(fieldClass, "mt-2 text-base")} />
          </label>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {t("send")}
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-4 border-l border-accent pl-4 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
