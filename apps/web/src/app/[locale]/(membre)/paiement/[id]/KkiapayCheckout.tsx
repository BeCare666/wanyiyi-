"use client";

import Script from "next/script";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { memberNav } from "@/components/member/memberNav";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { confirmKkiapayPayment } from "./actions";
import { canRetryVerification, transactionIdOf, type WidgetOptions } from "./checkout";

/** Fonctions posées sur window par le script officiel du widget (cdn.kkiapay.me/k.js). */
type KkiapayWindow = Window & {
  openKkiapayWidget?: (options: WidgetOptions) => void;
  addSuccessListener?: (listener: (response: unknown) => void) => void;
  addFailedListener?: (listener: (response: unknown) => void) => void;
};

const WIDGET_SCRIPT = "https://cdn.kkiapay.me/k.js";

const knownErrors = new Set([
  "transaction_not_successful",
  "amount_mismatch",
  "payment_mismatch",
  "transaction_not_found",
  "transaction_already_used",
  "kkiapay_unavailable",
  "invalid_status",
  "not_found",
  "unavailable",
  "failed",
]);

/**
 * Paiement dans le widget KkiaPay (Mobile Money, carte). Après un succès, la référence est envoyée
 * à l'API, qui vérifie la transaction chez KkiaPay avant de valider le paiement. Si KkiaPay ne
 * répond pas, la référence est gardée : le membre vérifie de nouveau au lieu de payer deux fois.
 */
export function KkiapayCheckout({ paymentId, options }: { paymentId: string; options: WidgetOptions }) {
  const t = useTranslations("Payment");
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<{ done: true } | { error: string; transactionId: string | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const confirming = useRef(false);

  const confirm = (transactionId: string) => {
    if (confirming.current) return;
    confirming.current = true;
    setState(null);
    startTransition(async () => {
      const result = await confirmKkiapayPayment(paymentId, transactionId);
      confirming.current = false;
      setState(result.ok ? { done: true } : { error: knownErrors.has(result.error) ? result.error : "generic", transactionId });
    });
  };

  // Réponse du widget : lue au moment de l'événement, avec l'état à jour
  const onSuccess = useEffectEvent((response: unknown) => {
    const transactionId = transactionIdOf(response);
    if (transactionId) confirm(transactionId);
    else setState({ error: "generic", transactionId: null });
  });

  // Écouteurs du widget, posés une fois le script chargé
  useEffect(() => {
    if (!ready) return;
    const w = window as KkiapayWindow;
    w.addSuccessListener?.((response) => onSuccess(response));
    w.addFailedListener?.(() => setState({ error: "failed", transactionId: null }));
  }, [ready]);

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

  const retry = state && "error" in state && state.transactionId && canRetryVerification(state.error) ? state.transactionId : null;

  return (
    <div className="mt-10">
      <Script src={WIDGET_SCRIPT} strategy="afterInteractive" onReady={() => setReady(true)} />
      {pending && (
        <p role="status" className="mb-8 text-fg-muted">
          {t("verifying")}
        </p>
      )}
      {state && "error" in state && (
        <p role="alert" className="mb-8 border-l border-accent pl-5">
          {t(`errors.${state.error}`, { ref: state.transactionId ?? "" })}
        </p>
      )}
      {retry ? (
        <Button type="button" disabled={pending} onClick={() => confirm(retry)} className="w-full">
          {t("retry")}
        </Button>
      ) : (
        <Button
          type="button"
          disabled={!ready || pending}
          onClick={() => {
            setState(null);
            (window as KkiapayWindow).openKkiapayWidget?.(options);
          }}
          className="w-full"
        >
          {ready ? t("pay") : t("loading")}
        </Button>
      )}
      <ButtonLink href={memberNav.evenings.href} variant="secondary" className="mt-3 w-full">
        {t("back")}
      </ButtonLink>
    </div>
  );
}
