"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { memberNav } from "@/components/member/memberNav";
import { Button, fieldClass } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/cn";
import { payByCard, payByMobile, refreshPayment } from "./actions";
import { type CardHolder, cardError, cardFields, isBeninPhone, type Method, type PayResult } from "./checkout";

const knownErrors = new Set([
  "invalid_phone",
  "invalid_card_holder",
  "payment_refused",
  "payment_in_progress",
  "payment_mismatch",
  "amount_mismatch",
  "transaction_already_used",
  "feexpay_unavailable",
  "invalid_status",
  "not_found",
  "unavailable",
  "failed",
]);

/** Vérification automatique d'une demande en attente : toutes les 5 secondes, pendant 2 minutes. */
const POLL_MS = 5_000;
const POLL_TIMES = 24;

const emptyHolder: CardHolder = { firstName: "", lastName: "", email: "", phoneNumber: "", city: "", zip: "" };

/**
 * Paiement par FeexPay (question 29, 22 octobre 2026), demandé par l'API : Mobile Money (MTN,
 * Moov, Celtiis), validé sur le téléphone du membre, ou carte sur la page FeexPay. Le statut est
 * toujours relu chez FeexPay par l'API. Une demande en attente est vérifiée, jamais refaite.
 */
export function FeexpayCheckout({ paymentId, methods, awaiting }: { paymentId: string; methods: Method[]; awaiting: boolean }) {
  const t = useTranslations("Payment");
  const [method, setMethod] = useState<Method>(methods[0] ?? "mtn");
  const [phone, setPhone] = useState("");
  const [holder, setHolder] = useState<CardHolder>(emptyHolder);
  const [state, setState] = useState<"form" | "waiting" | "done">(awaiting ? "waiting" : "form");
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const [pending, startTransition] = useTransition();
  const checking = useRef(false);

  function apply(result: { ok: true; data: PayResult } | { ok: false; error: string }) {
    if (!result.ok) {
      if (result.error === "payment_in_progress") setState("waiting");
      return setError(knownErrors.has(result.error) ? result.error : "generic");
    }
    if (result.data.paymentUrl) {
      // Page de paiement par carte chez FeexPay ; retour sur cette page, puis vérification
      window.location.assign(result.data.paymentUrl);
      return;
    }
    if (result.data.status === "succeeded") return setState("done");
    if (result.data.status === "pending") return setState("waiting");
    setState("form");
    setError("failed");
  }

  function check() {
    if (checking.current) return;
    checking.current = true;
    setError(null);
    startTransition(async () => {
      const result = await refreshPayment(paymentId);
      checking.current = false;
      apply(result);
    });
  }

  // Vérification automatique tant que la demande attend la validation du membre
  const tick = useEffectEvent(() => {
    setPolls((n) => n + 1);
    check();
  });
  useEffect(() => {
    if (state !== "waiting" || polls >= POLL_TIMES) return;
    const timer = setTimeout(tick, polls === 0 && awaiting ? 0 : POLL_MS);
    return () => clearTimeout(timer);
  }, [state, polls, awaiting]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (method === "card") {
      const wrong = cardError(holder);
      if (wrong) return setError(`card.${wrong}`);
    } else if (!isBeninPhone(phone)) {
      return setError("invalid_phone");
    }
    setPolls(0);
    startTransition(async () => {
      apply(method === "card" ? await payByCard(paymentId, holder) : await payByMobile(paymentId, method, phone));
    });
  }

  const errorText = error ? (error.startsWith("card.") ? t(`card.errors.${error.slice(5)}`) : t(`errors.${error}`)) : null;
  const back = (
    <ButtonLink href={memberNav.evenings.href} variant="secondary" className="mt-3 w-full">
      {t("back")}
    </ButtonLink>
  );

  if (state === "done") {
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

  if (state === "waiting") {
    return (
      <div className="mt-10">
        <p role="status" className="border-l border-fg pl-5">
          {pending ? t("verifying") : t("waiting")}
        </p>
        {errorText && error !== "payment_in_progress" && (
          <p role="alert" className="mt-6 border-l border-accent pl-5">
            {errorText}
          </p>
        )}
        <Button type="button" disabled={pending} onClick={check} className="mt-8 w-full">
          {t("retry")}
        </Button>
        {back}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-10">
      <fieldset>
        <legend className="text-sm font-medium">{t("method")}</legend>
        <div className="mt-3 grid gap-2">
          {methods.map((m) => (
            <label key={m} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border border-line px-4 has-[:checked]:border-fg">
              <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} />
              <span>{t(`methods.${m}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {method === "card" ? (
        <div className="mt-8 grid gap-5">
          <p className="text-sm text-fg-muted">{t("card.intro")}</p>
          {cardFields.map((field) => (
            <label key={field} className="block">
              <span className="text-sm font-medium">{t(`card.fields.${field}`)}</span>
              <input
                type={field === "email" ? "email" : field === "phoneNumber" ? "tel" : "text"}
                autoComplete={{ firstName: "given-name", lastName: "family-name", email: "email", phoneNumber: "tel", city: "address-level2", zip: "postal-code" }[field]}
                value={holder[field]}
                onChange={(e) => setHolder({ ...holder, [field]: e.target.value })}
                maxLength={field === "email" ? 120 : field === "zip" ? 10 : 60}
                className={cn(fieldClass, "mt-1 text-base")}
              />
            </label>
          ))}
        </div>
      ) : (
        <label className="mt-8 block">
          <span className="text-sm font-medium">{t("phone")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("phoneHelp")}</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
            className={cn(fieldClass, "mt-1 text-base")}
          />
        </label>
      )}

      {errorText && (
        <p role="alert" className="mt-6 border-l border-accent pl-5">
          {errorText}
        </p>
      )}
      {/* Après une erreur, une nouvelle demande est sûre : l'API relit d'abord la précédente */}
      <Button type="submit" disabled={pending} className="mt-8 w-full">
        {pending ? t("sending") : method === "card" ? t("payCard") : t("pay")}
      </Button>
      {back}
    </form>
  );
}
