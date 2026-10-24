"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { deleteTheme } from "./actions";

const knownErrors = new Set(["theme_in_use", "forbidden", "unavailable"]);

/** Suppression d'un thème, avec une seconde confirmation sur la page. Refusée s'il sert à une soirée. */
export function DeleteTheme({ id }: { id: string }) {
  const t = useTranslations("Admin.themes");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await deleteTheme(id);
      setConfirming(false);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  }

  return (
    <div className="text-sm">
      {confirming ? (
        <span className="inline-flex flex-wrap gap-4">
          <button type="button" disabled={pending} onClick={run} className="text-link underline underline-offset-4">
            {t("confirmDelete")}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="text-fg-muted underline-offset-4 hover:underline">
            {t("keep")}
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="text-link underline-offset-4 hover:underline">
          {t("delete")}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 border-l border-accent pl-3">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
