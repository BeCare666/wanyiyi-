"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { memberNav } from "@/components/member/memberNav";
import { succeedSimulatedPayment } from "./actions";

const knownErrors = new Set(["simulated_payments_disabled", "invalid_status", "not_found", "unavailable"]);

/** Bouton de validation du paiement de démonstration, puis retour aux soirées. */
export function SimulatedCheckout({ paymentId }: { paymentId: string }) {
  const t = useTranslations("SimulatedPayment");
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: true } | { error: string } | null>(null);

  function pay() {
    setState(null);
    startTransition(async () => {
      const result = await succeedSimulatedPayment(paymentId);
      setState(result.ok ? { done: true } : { error: result.error });
    });
  }

  if (state && "done" in state) {
    return (
      <div className="mt-10">
        <p role="status" className="border-l border-fg pl-5">
          {t("done")}
        </p>
        <ButtonLink href={memberNav.evenings.href} className="mt-8 w-full">
          {t("back")}
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="mt-10">
      {state && "error" in state && (
        <p role="alert" className="mb-8 border-l border-accent pl-5">
          {t(`errors.${knownErrors.has(state.error) ? state.error : "generic"}`)}
        </p>
      )}
      <Button type="button" disabled={pending} onClick={pay} className="w-full">
        {t("submit")}
      </Button>
      <ButtonLink href={memberNav.evenings.href} variant="secondary" className="mt-3 w-full">
        {t("back")}
      </ButtonLink>
    </div>
  );
}
