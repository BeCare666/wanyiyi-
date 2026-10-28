"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { type ContributionInput, checkContribution, MESSAGE_MAX, NAME_MAX } from "@/lib/cagnotte";
import { cn } from "@/lib/cn";
import { isBeninPhone } from "../../../(membre)/paiement/[id]/checkout";
import { type ContributionPay, payContribution, refreshContribution, startContribution, succeedSimulatedContribution } from "./actions";

const networks = ["mtn", "moov", "celtiis"] as const;
const knownErrors = new Set([
  "name_required",
  "message_too_long",
  "invalid_amount",
  "contact_details",
  "cagnotte_closed",
  "not_found",
  "invalid_phone",
  "payment_refused",
  "payment_in_progress",
  "feexpay_unavailable",
  "simulated_payments_disabled",
  "failed",
  "unavailable",
]);

/** Vérification automatique d'une demande en attente : toutes les 5 secondes, pendant 2 minutes. */
const POLL_MS = 5_000;
const POLL_TIMES = 24;

/**
 * Contribution sans compte (phase 4, question 3 b et g) : nom affiché ou « Anonyme », message
 * facultatif, montant (minimum réglé par l'équipe), montant masqué au couple si souhaité ; puis
 * paiement Mobile Money (MTN, Moov, Celtiis) demandé à FeexPay par l'API.
 */
export function ContributionForm({ token, minXof }: { token: string; minXof: number }) {
  const t = useTranslations("Cagnotte");
  const tp = useTranslations("Payment");
  const format = useFormatter();
  const [input, setInput] = useState<ContributionInput>({ name: "", anonymous: false, message: "", amount: "", hideAmount: false });
  const [payment, setPayment] = useState<{ id: string; provider: "simulated" | "feexpay" } | null>(null);
  const [network, setNetwork] = useState<(typeof networks)[number]>("mtn");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"details" | "pay" | "waiting" | "done">("details");
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const [pending, startTransition] = useTransition();
  const checking = useRef(false);

  const fail = (code: string) => setError(knownErrors.has(code) ? code : "generic");

  function apply(result: { ok: true; data: ContributionPay } | { ok: false; error: string }) {
    if (!result.ok) {
      if (result.error === "payment_in_progress") setState("waiting");
      return fail(result.error);
    }
    if (result.data.status === "succeeded") return setState("done");
    if (result.data.status === "pending") return setState("waiting");
    setState("pay");
    setError("failed");
  }

  function check() {
    if (!payment || checking.current) return;
    checking.current = true;
    setError(null);
    startTransition(async () => {
      const result = await refreshContribution(payment.id);
      checking.current = false;
      apply(result);
    });
  }

  const tick = useEffectEvent(() => {
    setPolls((n) => n + 1);
    check();
  });
  useEffect(() => {
    if (state !== "waiting" || polls >= POLL_TIMES) return;
    const timer = setTimeout(tick, POLL_MS);
    return () => clearTimeout(timer);
  }, [state, polls]);

  function submitDetails(e: FormEvent) {
    e.preventDefault();
    const invalid = checkContribution(input, minXof);
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const result = await startContribution(token, input, minXof);
      if (!result.ok) return fail(result.error);
      setPayment({ id: result.data.paymentId, provider: result.data.provider });
      setState("pay");
    });
  }

  function submitPayment(e: FormEvent) {
    e.preventDefault();
    if (!payment) return;
    setError(null);
    if (payment.provider === "simulated") {
      return startTransition(async () => {
        const result = await succeedSimulatedContribution(payment.id);
        if (!result.ok) return fail(result.error);
        setState("done");
      });
    }
    if (!isBeninPhone(phone)) return setError("invalid_phone");
    setPolls(0);
    startTransition(async () => apply(await payContribution(payment.id, network, phone)));
  }

  const errorLine = error && (
    <p role="alert" className="mt-6 border-l border-accent pl-5">
      {t(`errors.${error}`)}
    </p>
  );

  if (state === "done") {
    return (
      <p role="status" className="mt-10 border-l border-fg pl-5 text-lg">
        {t("thanks")}
      </p>
    );
  }

  if (state === "waiting") {
    return (
      <div className="mt-10">
        <p role="status" className="border-l border-fg pl-5">
          {pending ? tp("verifying") : tp("waiting")}
        </p>
        {error !== "payment_in_progress" && errorLine}
        <Button type="button" disabled={pending} onClick={check} className="mt-8">
          {tp("retry")}
        </Button>
      </div>
    );
  }

  if (state === "pay" && payment) {
    const amount = format.number(Number(input.amount.replace(/\s/g, "")), { style: "currency", currency: "XOF", maximumFractionDigits: 0 });
    return (
      <form onSubmit={submitPayment} noValidate className="mt-10 grid gap-6">
        <p className="text-lg">{t("toPay", { amount })}</p>
        {payment.provider === "simulated" ? (
          <p className="max-w-measure text-sm text-fg-muted">{t("simulated")}</p>
        ) : (
          <>
            <fieldset>
              <legend className="text-sm font-medium">{tp("method")}</legend>
              <div className="mt-3 grid gap-2">
                {networks.map((m) => (
                  <label key={m} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border border-line px-4 has-[:checked]:border-fg">
                    <input type="radio" name="network" value={m} checked={network === m} onChange={() => setNetwork(m)} />
                    <span>{tp(`methods.${m}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="text-sm font-medium">{t("phone")}</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} className={cn(fieldClass, "text-base")} />
            </label>
          </>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {payment.provider === "simulated" ? t("payDemo") : t("pay")}
          </Button>
        </div>
        {errorLine}
      </form>
    );
  }

  return (
    <form onSubmit={submitDetails} noValidate className="mt-10 grid gap-6">
      <label className="block">
        <span className="text-sm font-medium">{t("name")}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t("nameHelp")}</span>
        <input
          value={input.name}
          disabled={input.anonymous}
          onChange={(e) => setInput({ ...input, name: e.target.value })}
          maxLength={NAME_MAX}
          autoComplete="name"
          className={cn(fieldClass, "text-base disabled:opacity-50")}
        />
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3">
        <input type="checkbox" checked={input.anonymous} onChange={(e) => setInput({ ...input, anonymous: e.target.checked })} className="size-4 accent-[var(--accent)]" />
        <span>{t("anonymous")}</span>
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t("message")}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t("messageHelp", { max: MESSAGE_MAX })}</span>
        <textarea value={input.message} onChange={(e) => setInput({ ...input, message: e.target.value })} maxLength={MESSAGE_MAX} rows={3} className={cn(fieldClass, "text-base")} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t("amount")}</span>
        <span className="mt-1 block text-xs text-fg-muted">
          {t("amountHelp", { min: format.number(minXof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 }) })}
        </span>
        <input value={input.amount} onChange={(e) => setInput({ ...input, amount: e.target.value })} inputMode="numeric" maxLength={11} className={cn(fieldClass, "text-base")} />
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3">
        <input type="checkbox" checked={input.hideAmount} onChange={(e) => setInput({ ...input, hideAmount: e.target.checked })} className="size-4 accent-[var(--accent)]" />
        <span>{t("hideAmount")}</span>
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {t("continue")}
        </Button>
      </div>
      {errorLine}
    </form>
  );
}
