"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import type { ApiResult } from "@/lib/api";
import { answerCounselor, decideCouple, declareDate, inviteCounselor, leaveCouple, payCounselor, revokeCounselor, sharePhone } from "./actions";
import type { CounselorState } from "./couple";

const knownErrors = new Set([
  "not_member",
  "invalid_status",
  "couple_blocked",
  "couple_closed",
  "phone_sharing_disabled",
  "no_phone",
  "invalid_date",
  "access_pending",
  "not_pending",
  "own_request",
  "nothing_to_pay",
  "unavailable",
]);

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ApiResult<unknown>>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      after?.();
      router.refresh();
    });
  };
  return { error, pending, run };
}

function ErrorLine({ error }: { error: string | null }) {
  const t = useTranslations("Member.couple.errors");
  return error ? (
    <p role="alert" className="mt-3 border-l border-accent pl-4 text-sm">
      {t(error)}
    </p>
  ) : null;
}

/** Bouton qui demande une seconde confirmation sur la page (décisions qui engagent le couple). */
function ConfirmButton({
  label,
  confirmText,
  confirmLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmText: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("Member.couple");
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => setConfirming(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="w-full max-w-xl border-l border-accent pl-5">
      <p>{confirmText}</p>
      <div className="mt-4 flex flex-wrap gap-4">
        <Button
          type="button"
          disabled={disabled}
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
          {t("keep")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Décisions du couple (question 7) : reprise après une pause, union et séparation (effet quand les
 * deux l'ont fait), garder la conversation après l'union, départ d'un seul (effet immédiat).
 */
export function CoupleDecisions({
  coupleId,
  decisions,
  myRequests,
  canLeave,
}: {
  coupleId: string;
  decisions: ("resume" | "union" | "separation" | "keep_chat")[];
  myRequests: string[];
  canLeave: boolean;
}) {
  const t = useTranslations("Member.couple.decisions");
  const { error, pending, run } = useAction();
  const done = (kind: string) => myRequests.includes(kind);

  return (
    <div>
      <ul className="border-t border-line">
        {decisions.map((kind) => (
          <li key={kind} className="border-b border-line py-6">
            <p className="max-w-measure text-sm text-fg-muted">{t(`${kind}Help`)}</p>
            <div className="mt-4 flex flex-wrap gap-4">
              {done(kind) ? (
                <p className="text-sm">{t("recorded")}</p>
              ) : kind === "resume" || kind === "keep_chat" ? (
                <Button type="button" disabled={pending} onClick={() => run(() => decideCouple(coupleId, kind))}>
                  {t(kind)}
                </Button>
              ) : (
                <ConfirmButton
                  label={t(kind)}
                  confirmText={t(`${kind}Confirm`)}
                  confirmLabel={t("confirm")}
                  disabled={pending}
                  onConfirm={() => run(() => decideCouple(coupleId, kind))}
                />
              )}
            </div>
          </li>
        ))}
        {canLeave && (
          <li className="border-b border-line py-6">
            <p className="max-w-measure text-sm text-fg-muted">{t("leaveHelp")}</p>
            <div className="mt-4 flex flex-wrap gap-4">
              <ConfirmButton
                label={t("leave")}
                confirmText={t("leaveConfirm")}
                confirmLabel={t("confirm")}
                disabled={pending}
                onConfirm={() => run(() => leaveCouple(coupleId))}
              />
            </div>
          </li>
        )}
      </ul>
      <ErrorLine error={error} />
    </div>
  );
}

/** Partage des numéros (9.5) : le numéro de l'autre n'apparaît que quand les deux ont cliqué. */
export function PhoneShare({
  coupleId,
  iShared,
  canShare,
  partnerPhone,
  partnerName,
}: {
  coupleId: string;
  iShared: boolean;
  canShare: boolean;
  partnerPhone: string | null;
  partnerName: string;
}) {
  const t = useTranslations("Member.couple.phone");
  const { error, pending, run } = useAction();
  if (partnerPhone) {
    return (
      <p className="mt-4">
        {t("partner", { name: partnerName })}{" "}
        <a href={`tel:${partnerPhone}`} className="font-serif text-2xl text-link underline-offset-4 hover:underline">
          {partnerPhone}
        </a>
      </p>
    );
  }
  if (iShared) return <p className="mt-4 text-sm text-fg-muted">{t("waiting")}</p>;
  if (!canShare) return <p className="mt-4 text-sm text-fg-muted">{t("disabled")}</p>;
  return (
    <div className="mt-4">
      <Button type="button" disabled={pending} onClick={() => run(() => sharePhone(coupleId))}>
        {t("share")}
      </Button>
      <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("private")}</p>
      <ErrorLine error={error} />
    </div>
  );
}

/** Déclarer un rendez-vous (date et heure de Cotonou) : compté comme activité du couple. */
export function DateForm({ coupleId }: { coupleId: string }) {
  const t = useTranslations("Member.couple.dates");
  const [value, setValue] = useState("");
  const { error, pending, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value === "") return;
    run(() => declareDate(coupleId, value), () => setValue(""));
  };
  return (
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-4">
      <label className="block">
        <span className="text-sm">{t("when")}</span>
        <input type="datetime-local" required value={value} onChange={(e) => setValue(e.target.value)} className={`${fieldClass} mt-2`} />
      </label>
      <Button type="submit" disabled={pending || value === ""}>
        {t("declare")}
      </Button>
      <div className="w-full">
        <ErrorLine error={error} />
      </div>
    </form>
  );
}

/**
 * Conseiller du couple (question 9) : invitation par l'un, accord de l'autre, paiement par celui
 * qui a invité, attribution par l'équipe ; retrait par l'un ou l'autre à tout moment.
 */
export function CounselorPanel({
  coupleId,
  accessId,
  state,
  canInvite,
  price,
}: {
  coupleId: string;
  accessId: string | null;
  state: CounselorState;
  canInvite: boolean;
  /** Prix affiché, déjà mis en forme (prix figé de l'accès, ou prix actuel avant d'inviter). */
  price: string | null;
}) {
  const t = useTranslations("Member.couple.counselor");
  const [history, setHistory] = useState(false);
  const { error, pending, run } = useAction();
  const [paying, startPaying] = useTransition();
  const [payError, setPayError] = useState<string | null>(null);

  const historyBox = (
    <label className="mt-4 flex min-h-12 max-w-xl cursor-pointer items-center justify-between gap-6">
      <span>
        {t("history")}
        <span className="mt-1 block text-sm text-fg-muted">{t("historyHelp")}</span>
      </span>
      <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="size-5 shrink-0 accent-[var(--accent)]" />
    </label>
  );

  const pay = () => {
    if (!accessId) return;
    setPayError(null);
    startPaying(async () => {
      const result = await payCounselor(accessId);
      if (!result.ok) return setPayError(knownErrors.has(result.error) ? result.error : "generic");
      window.location.assign(result.data.checkoutUrl);
    });
  };

  return (
    <div className="mt-4">
      <p className="max-w-measure">{t(`state.${state}`, { price: price ?? "" })}</p>

      {state === "none" && canInvite && (
        <>
          {price && <p className="mt-3 text-sm text-fg-muted">{t("price", { price })}</p>}
          {historyBox}
          <div className="mt-4">
            <Button type="button" disabled={pending} onClick={() => run(() => inviteCounselor(coupleId, history))}>
              {t("invite")}
            </Button>
          </div>
        </>
      )}

      {state === "toAnswer" && accessId && (
        <>
          {historyBox}
          <div className="mt-4 flex flex-wrap gap-4">
            <Button type="button" disabled={pending} onClick={() => run(() => answerCounselor(accessId, true, history))}>
              {t("accept")}
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => answerCounselor(accessId, false, false))}>
              {t("refuse")}
            </Button>
          </div>
        </>
      )}

      {state === "toPay" && (
        <div className="mt-4">
          <Button type="button" disabled={paying} onClick={pay}>
            {t("pay", { price: price ?? "" })}
          </Button>
          <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("noRefund")}</p>
          <ErrorLine error={payError} />
        </div>
      )}

      {accessId && state !== "none" && state !== "toAnswer" && (
        <div className="mt-4">
          <ConfirmButton
            label={state === "granted" ? t("remove") : t("cancel")}
            confirmText={state === "granted" ? t("removeConfirm") : t("cancelConfirm")}
            confirmLabel={state === "granted" ? t("remove") : t("cancel")}
            disabled={pending}
            onConfirm={() => run(() => revokeCounselor(accessId))}
          />
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}
