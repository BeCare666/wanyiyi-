"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { bookEvening, cancelEvening, confirmEvening, payEvening } from "./actions";
import { type EveningAction, knownEveningErrors } from "./evenings";

type Notice = { kind: "done"; key: "seat" | "waitlist" | "confirmed" | "cancelled" } | { kind: "error"; code: string };

/**
 * Boutons d'une soirée. Après chaque action, la page est rechargée côté serveur :
 * places restantes et situation du membre viennent toujours de la base.
 * L'annulation demande une seconde confirmation, sur la page (pas de fenêtre du navigateur).
 */
export function EveningActions({ eventId, actions }: { eventId: string; actions: EveningAction[] }) {
  const t = useTranslations("Member.evenings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [askCancel, setAskCancel] = useState(false);

  function run(action: EveningAction) {
    setNotice(null);
    startTransition(async () => {
      if (action === "book" || action === "waitlist") {
        const result = await bookEvening(eventId);
        if (!result.ok) return setNotice({ kind: "error", code: result.error });
        setNotice({ kind: "done", key: result.data.outcome === "seat" ? "seat" : "waitlist" });
      } else if (action === "confirm") {
        const result = await confirmEvening(eventId);
        if (!result.ok) return setNotice({ kind: "error", code: result.error });
        setNotice({ kind: "done", key: "confirmed" });
      } else if (action === "cancel") {
        setAskCancel(false);
        const result = await cancelEvening(eventId);
        if (!result.ok) return setNotice({ kind: "error", code: result.error });
        setNotice({ kind: "done", key: "cancelled" });
      } else {
        const result = await payEvening(eventId);
        if (!result.ok) return setNotice({ kind: "error", code: result.error });
        window.location.assign(result.data.checkoutUrl);
        return;
      }
      router.refresh();
    });
  }

  const label = (action: EveningAction) => t(`actions.${action}`);

  return (
    <div className="mt-4 flex flex-col gap-3 md:items-end">
      {askCancel ? (
        <div role="group" aria-label={t("actions.cancelAsk")} className="flex flex-col gap-3 md:items-end">
          <p className="text-sm">{t("actions.cancelAsk")}</p>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => run("cancel")}>
              {t("actions.cancelYes")}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setAskCancel(false)}>
              {t("actions.cancelNo")}
            </Button>
          </div>
        </div>
      ) : (
        actions.map((action) =>
          action === "cancel" ? (
            <button
              key={action}
              type="button"
              disabled={pending}
              onClick={() => setAskCancel(true)}
              className="text-sm text-link underline-offset-4 hover:underline disabled:opacity-50"
            >
              {label(action)}
            </button>
          ) : (
            <Button
              key={action}
              type="button"
              variant={action === "pay" ? "secondary" : "primary"}
              disabled={pending}
              onClick={() => run(action)}
            >
              {label(action)}
            </Button>
          ),
        )
      )}

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={notice.kind === "error" ? "border-l border-accent pl-4 text-sm md:text-left" : "border-l border-fg pl-4 text-sm md:text-left"}
        >
          {notice.kind === "error"
            ? t(`errors.${knownEveningErrors.has(notice.code) ? notice.code : "generic"}`)
            : t(`done.${notice.key}`)}
          {/* Erreur sans texte dédié : le code reste lisible, pour que l'équipe trouve la cause */}
          {notice.kind === "error" && !knownEveningErrors.has(notice.code) && (
            <span className="mt-1 block text-xs text-fg-muted">{t("errors.code", { code: notice.code })}</span>
          )}
        </p>
      )}
    </div>
  );
}
