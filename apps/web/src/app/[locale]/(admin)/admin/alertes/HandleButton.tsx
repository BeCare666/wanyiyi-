"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { handleAlert } from "./actions";

/** « Marquer comme traitée » une alerte après avoir contacté le membre. */
export function HandleButton({ checkinId, userId }: { checkinId: string; userId: string }) {
  const t = useTranslations("Admin.alerts");
  const router = useRouter();
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await handleAlert(checkinId, userId);
            if (!result.ok) return setError(true);
            router.refresh();
          })
        }
      >
        {t("handle")}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {t("error")}
        </p>
      )}
    </div>
  );
}
