"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import type { ApiResult } from "@/lib/api";
import {
  acceptSession,
  answerCounselor,
  confirmMilestone,
  decideCouple,
  inviteCounselor,
  leaveCouple,
  payCounselor,
  revokeCounselor,
  setMilestoneDate,
  sharePhone,
  unsharePhone,
} from "./actions";
import { type CounselorState, milestoneState, type MilestoneRow, type SessionRow } from "./couple";

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
  "automatic_milestone",
  "not_active",
  "no_counselor",
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
  highlightUnion = false,
}: {
  coupleId: string;
  decisions: ("resume" | "union" | "separation" | "keep_chat")[];
  myRequests: string[];
  canLeave: boolean;
  /** « Célébration » franchie : l'union est proposée en premier (question 16 e), jamais automatique. */
  highlightUnion?: boolean;
}) {
  const t = useTranslations("Member.couple.decisions");
  const { error, pending, run } = useAction();
  const done = (kind: string) => myRequests.includes(kind);
  const ordered = highlightUnion ? [...decisions].sort((a, b) => Number(b === "union") - Number(a === "union")) : decisions;

  return (
    <div>
      {highlightUnion && decisions.includes("union") && !done("union") && (
        <p className="mb-4 max-w-measure border-l border-accent pl-5">{t("unionInvite")}</p>
      )}
      <ul className="border-t border-line">
        {ordered.map((kind) => (
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

/**
 * Partage des numéros (9.5) : le numéro de l'autre n'apparaît que quand les deux ont cliqué ;
 * chacun peut retirer son accord à tout moment (question 17), discrètement.
 */
export function PhoneShare({
  coupleId,
  iShared,
  canShare,
  partnerPhone,
  partnerName,
  canShareNow,
}: {
  coupleId: string;
  iShared: boolean;
  canShare: boolean;
  partnerPhone: string | null;
  partnerName: string;
  /** Nouveau partage possible (couple en cours ou en pause) ; après l'union, retrait seulement. */
  canShareNow: boolean;
}) {
  const t = useTranslations("Member.couple.phone");
  const { error, pending, run } = useAction();
  const unshare = iShared && (
    <div className="mt-4">
      <ConfirmButton
        label={t("unshare")}
        confirmText={t("unshareConfirm")}
        confirmLabel={t("unshare")}
        disabled={pending}
        onConfirm={() => run(() => unsharePhone(coupleId))}
      />
      <ErrorLine error={error} />
    </div>
  );
  if (partnerPhone) {
    return (
      <>
        <p className="mt-4">
          {t("partner", { name: partnerName })}{" "}
          <a href={`tel:${partnerPhone}`} className="font-serif text-2xl text-link underline-offset-4 hover:underline">
            {partnerPhone}
          </a>
        </p>
        {unshare}
      </>
    );
  }
  if (iShared) {
    return (
      <>
        <p className="mt-4 text-sm text-fg-muted">{t("waiting")}</p>
        {unshare}
      </>
    );
  }
  if (!canShareNow) return null;
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

/**
 * Déclarer un rendez-vous (date et heure de Cotonou), pendant le couple ou la découverte : il
 * déclenche « Bien rentré(e) ? » 3 heures après (question 5). `declare` : action liée au couple
 * ou à la découverte.
 */
export function DateForm({ declare }: { declare: (localDateTime: string) => Promise<ApiResult<string>> }) {
  const t = useTranslations("Member.couple.dates");
  const [value, setValue] = useState("");
  const { error, pending, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value === "") return;
    run(() => declare(value), () => setValue(""));
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

/**
 * Parcours en 5 étapes (question 16) : une étape est franchie, ou retirée, quand les deux l'ont
 * confirmée ; l'autre est prévenu dans la conversation. Date corrigeable par l'un ou l'autre.
 * « Séances avec le conseiller » se coche seule à la première séance faite.
 */
export function MilestoneList({ coupleId, rows, editable }: { coupleId: string; rows: MilestoneRow[]; editable: boolean }) {
  const t = useTranslations("Member.couple.journey");
  const format = useFormatter();
  const { error, pending, run } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [date, setDate] = useState("");

  return (
    <div>
      <ol className="mt-4 border-t border-line">
        {rows.map((row, i) => {
          const state = milestoneState(row);
          return (
            <li key={row.kind} className="border-b border-line py-5">
              <div className="grid gap-2 md:grid-cols-12 md:items-baseline md:gap-8">
                <p className="md:col-span-7">
                  <span className="mr-3 text-sm text-fg-muted">{i + 1}.</span>
                  {t(row.kind)}
                </p>
                <p className="text-sm text-fg-muted md:col-span-5 md:text-right">
                  {row.reached_at
                    ? t("reached", { date: format.dateTime(new Date(row.reached_at), { dateStyle: "long", timeZone: "Africa/Porto-Novo" }) })
                    : state === "auto"
                      ? t("auto")
                      : t("notYet")}
                </p>
              </div>
              {editable && state !== "auto" && (
                <div className="mt-3 flex flex-wrap items-end gap-4 text-sm">
                  {state === "reach" && (
                    <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => confirmMilestone(coupleId, row.kind, "reach"))}>
                      {t("confirmReach")}
                    </Button>
                  )}
                  {state === "waitingReach" && <p className="text-fg-muted">{t("waitingReach")}</p>}
                  {state === "waitingRemove" && <p className="text-fg-muted">{t("waitingRemove")}</p>}
                  {state === "reached" &&
                    (editing === row.kind ? (
                      <form
                        className="flex flex-wrap items-end gap-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          run(() => setMilestoneDate(coupleId, row.kind, date), () => setEditing(null));
                        }}
                      >
                        <label className="block">
                          <span>{t("date")}</span>
                          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={`${fieldClass} mt-2`} />
                        </label>
                        <Button type="submit" disabled={pending || date === ""}>
                          {t("saveDate")}
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                          {t("cancel")}
                        </Button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="min-h-11 text-link underline-offset-4 hover:underline"
                          onClick={() => {
                            setDate(row.reached_at!.slice(0, 10));
                            setEditing(row.kind);
                          }}
                        >
                          {t("changeDate")}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          className="min-h-11 text-link underline-offset-4 hover:underline"
                          onClick={() => run(() => confirmMilestone(coupleId, row.kind, "remove"))}
                        >
                          {t("confirmRemove")}
                        </button>
                      </>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {editable && <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("help")}</p>}
      <ErrorLine error={error} />
    </div>
  );
}

/**
 * Séances avec le conseiller (question 9) : comprises dans l'accès déjà payé ; chacun des deux
 * accepte la date proposée d'un clic, la séance est confirmée quand les deux l'ont fait.
 */
export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const t = useTranslations("Member.couple.sessions");
  const format = useFormatter();
  const { error, pending, run } = useAction();
  if (sessions.length === 0) return <p className="mt-4 text-sm text-fg-muted">{t("none")}</p>;
  return (
    <div>
      <ol className="mt-4 border-t border-line">
        {sessions.map((s) => (
          <li key={s.id} className="grid gap-2 border-b border-line py-5 md:grid-cols-12 md:items-center md:gap-8">
            <p className="md:col-span-5">
              {format.dateTime(new Date(s.scheduled_at), { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Porto-Novo" })}
              <span className="block text-sm text-fg-muted">{s.mode === "online" ? t("online") : t("place", { place: s.location ?? "" })}</span>
            </p>
            <p className="text-sm md:col-span-3">{t(`status.${s.status}`)}</p>
            <div className="text-sm md:col-span-4 md:text-right">
              {s.status === "proposed" &&
                (s.i_accepted ? (
                  <span className="text-fg-muted">{t("waiting")}</span>
                ) : (
                  <Button type="button" disabled={pending} onClick={() => run(() => acceptSession(s.id))}>
                    {t("accept")}
                  </Button>
                ))}
            </div>
          </li>
        ))}
      </ol>
      <ErrorLine error={error} />
    </div>
  );
}
