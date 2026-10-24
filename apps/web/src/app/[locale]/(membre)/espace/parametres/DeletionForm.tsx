"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cancelDeletion, requestDeletion } from "./actions";
import type { Deletion, DeletionResult } from "./settings";

/**
 * Suppression du compte (question 17, 24 octobre 2026) : délai de 30 jours, compte masqué tout de
 * suite, annulable pendant le délai. La demande demande une seconde confirmation sur la page.
 */
export function DeletionForm({ deletion }: { deletion: Deletion }) {
  const t = useTranslations("Member.settings.deletion");
  const format = useFormatter();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DeletionResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<DeletionResult>) {
    setBusy(true);
    const outcome = await action();
    setBusy(false);
    setResult(outcome);
    setConfirming(false);
    if (outcome === "requested" || outcome === "cancelled") router.refresh();
  }

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "Africa/Porto-Novo" });
  const done = result === "requested" || result === "cancelled";

  return (
    <section id="suppression" aria-labelledby="suppression-titre" className="mt-14 border-t border-line pt-10">
      <h2 id="suppression-titre" className="text-2xl">
        {t("title")}
      </h2>
      {deletion ? (
        <>
          <p className="mt-3 max-w-measure border-l border-accent pl-5">{t("pending", { date: date(deletion.purgeAfter) })}</p>
          <div className="mt-6">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(cancelDeletion)}>
              {t("cancel")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 max-w-measure text-fg-muted">{t("help")}</p>
          {confirming ? (
            <div className="mt-6 max-w-xl border-l border-accent pl-5">
              <p>{t("confirmText")}</p>
              <div className="mt-4 flex flex-wrap gap-4">
                <Button type="button" disabled={busy} onClick={() => void run(requestDeletion)}>
                  {t("confirm")}
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  {t("keep")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
                {t("request")}
              </Button>
            </div>
          )}
        </>
      )}
      {result && (
        <p role={done ? "status" : "alert"} className="mt-4 max-w-measure border-l border-accent pl-5 text-sm">
          {t(`states.${result}`)}
        </p>
      )}
    </section>
  );
}
