"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { markContacted } from "./actions";

/**
 * « J'ai contacté ce prestataire » (phase 4, question 2 d) : compte seulement l'intérêt pour
 * l'équipe ; rien n'est envoyé au prestataire.
 */
export function ContactedButton({ providerId, contacted }: { providerId: string; contacted: boolean }) {
  const t = useTranslations("Providers");
  const router = useRouter();
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  if (contacted) {
    return (
      <p className="mt-4 inline-flex items-center gap-2 text-sm text-fg-muted">
        <CheckIcon size={16} weight="light" aria-hidden="true" />
        {t("contacted")}
      </p>
    );
  }
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await markContacted(providerId);
            if (!result.ok) return setError(true);
            router.refresh();
          })
        }
        className="inline-flex min-h-10 items-center text-sm text-link underline-offset-4 hover:underline disabled:opacity-50"
      >
        {t("markContacted")}
      </button>
      <p className="text-xs text-fg-muted">{t("markContactedHelp")}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {t("error")}
        </p>
      )}
    </div>
  );
}
