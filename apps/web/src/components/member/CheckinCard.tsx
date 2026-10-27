"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { answerCheckin } from "@/app/[locale]/(membre)/espace/checkin-actions";
import { Button } from "@/components/ui/Button";
import { siteContact } from "@/config/site";
import { useRouter } from "@/i18n/navigation";

export type PendingCheckin = { checkin_id: string; date_at: string; partner_first_name: string | null };

/**
 * « Bien rentré(e) ? » (question 5) : « Oui » ou « J'ai besoin d'aide ». Après une demande d'aide,
 * le numéro d'urgence de l'équipe reste affiché.
 */
export function CheckinCard({ checkin }: { checkin: PendingCheckin }) {
  const t = useTranslations("Member.checkin");
  const format = useFormatter();
  const router = useRouter();
  const [helped, setHelped] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const answer = (value: "ok" | "help") =>
    startTransition(async () => {
      const result = await answerCheckin(checkin.checkin_id, value);
      if (!result.ok) return setError(true);
      setError(false);
      if (value === "help") setHelped(true);
      else router.refresh();
    });

  const whatsapp = siteContact.whatsapp;
  return (
    <section aria-labelledby={`checkin-${checkin.checkin_id}`} className="border-l-2 border-accent bg-bg-soft px-6 py-6">
      <h2 id={`checkin-${checkin.checkin_id}`} className="font-serif text-2xl">
        {t("title")}
      </h2>
      <p className="mt-2 text-fg-muted">
        {t("context", {
          name: checkin.partner_first_name ?? "",
          date: format.dateTime(new Date(checkin.date_at), { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Porto-Novo" }),
        })}
      </p>
      {helped ? (
        <div role="status" className="mt-4">
          <p>{t("helpSent")}</p>
          {whatsapp && (
            <p className="mt-2">
              {t("emergency")}{" "}
              <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} className="font-serif text-xl text-link underline-offset-4 hover:underline">
                {whatsapp}
              </a>
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-4">
            <Button type="button" disabled={pending} onClick={() => answer("ok")}>
              {t("ok")}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => answer("help")}>
              {t("help")}
            </Button>
          </div>
          <p className="mt-3 text-sm text-fg-muted">{t("private")}</p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 border-l border-accent pl-4 text-sm">
          {t("error")}
        </p>
      )}
    </section>
  );
}
