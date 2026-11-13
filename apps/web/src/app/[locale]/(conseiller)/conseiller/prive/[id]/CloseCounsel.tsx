"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { counselorCloseCounsel } from "../../actions";

/** Clôture d'une discussion demandée seule par un membre (10 novembre 2026). */
export function CloseCounsel({ requestId }: { requestId: string }) {
  const t = useTranslations("Counselor.private");
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-10 border-t border-line pt-6">
      <p className="max-w-measure text-sm text-fg-muted">{t("closeHelp")}</p>
      <Button
        variant="secondary"
        className="mt-4"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await counselorCloseCounsel(requestId);
            if (!result.ok) return setFailed(true);
            router.push("/conseiller");
          })
        }
      >
        {t("close")}
      </Button>
      {failed && (
        <p role="alert" className="mt-3 border-l border-accent pl-4 text-sm">
          {t("closeError")}
        </p>
      )}
    </div>
  );
}
