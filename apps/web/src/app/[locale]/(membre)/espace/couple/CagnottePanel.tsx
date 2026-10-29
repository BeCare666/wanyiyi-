"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import type { ApiResult } from "@/lib/api";
import { cagnotteUrl, type CagnotteView, checkProposal, type ContributionRow, type MyCagnotte, type ProposalInput, progressPercent, whatsappShare } from "@/lib/cagnotte";
import { cn } from "@/lib/cn";
import { answerCagnotte, cancelCagnotte, decideCagnotte, proposeCagnotte } from "./actions";

const knownErrors = new Set([
  "invalid_title",
  "invalid_goal",
  "invalid_closing",
  "invalid_phone",
  "contact_details",
  "too_early",
  "already_open",
  "not_member",
  "not_pending",
  "own_request",
  "invalid_status",
  "couple_blocked",
  "payout_pending",
  "nothing_to_pay_out",
  "payout_too_small",
  "unavailable",
]);

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ApiResult<unknown>>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      if (result.data === "recorded") setNotice("recorded");
      router.refresh();
    });
  };
  return { error, notice, pending, run, setError };
}

const today = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

/**
 * Cagnotte du couple (phase 4, question 3) : proposition par l'un et accord de l'autre, lien à
 * partager, contributions reçues, clôture anticipée et reversement demandés par les deux. Frais
 * annoncés à la proposition : commission Ifedele réglée par l'équipe, frais FeexPay déduits.
 */
export function CagnottePanel({
  coupleId,
  view,
  cagnotte,
  contributions,
  canPropose,
  commissionPercent,
  minPayout,
  siteUrl,
}: {
  coupleId: string;
  view: CagnotteView;
  cagnotte: MyCagnotte | null;
  contributions: ContributionRow[];
  canPropose: boolean;
  commissionPercent: number;
  minPayout: number;
  siteUrl: string;
}) {
  const t = useTranslations("Member.couple.cagnotte");
  const format = useFormatter();
  const { error, notice, pending, run, setError } = useAction();
  const [draft, setDraft] = useState<ProposalInput>({ title: "", goal: "", closesOn: "", phone: "" });
  const amount = (xof: number) => format.number(xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 });
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "Africa/Porto-Novo" });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const invalid = checkProposal(draft, today());
    if (invalid) return setError(invalid);
    run(() => proposeCagnotte(coupleId, draft));
  };

  const messages = (
    <>
      {error && (
        <p role="alert" className="mt-4 border-l border-accent pl-4 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm text-fg-muted">
          {t("recorded")}
        </p>
      )}
    </>
  );

  const details = cagnotte && (
    <dl className="mt-4 grid gap-1 text-sm">
      <div className="flex flex-wrap gap-2">
        <dt className="text-fg-muted">{t("titleLabel")}</dt>
        <dd>{cagnotte.title}</dd>
      </div>
      {cagnotte.goal_xof && (
        <div className="flex flex-wrap gap-2">
          <dt className="text-fg-muted">{t("goalLabel")}</dt>
          <dd>{amount(cagnotte.goal_xof)}</dd>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <dt className="text-fg-muted">{t("closesLabel")}</dt>
        <dd>{day(cagnotte.closes_at)}</dd>
      </div>
      <div className="flex flex-wrap gap-2">
        <dt className="text-fg-muted">{t("phoneLabel")}</dt>
        <dd>{cagnotte.payout_phone}</dd>
      </div>
    </dl>
  );

  if (view === "toAnswer" && cagnotte) {
    return (
      <div className="mt-4">
        <p>{t("toAnswer")}</p>
        {details}
        <p className="mt-4 max-w-measure text-sm text-fg-muted">{t("acceptHelp")}</p>
        <div className="mt-6 flex flex-wrap gap-4">
          <Button type="button" disabled={pending} onClick={() => run(() => answerCagnotte(cagnotte.id, true))}>
            {t("accept")}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => answerCagnotte(cagnotte.id, false))}>
            {t("refuse")}
          </Button>
        </div>
        {messages}
      </div>
    );
  }

  if (view === "waitingOther" && cagnotte) {
    return (
      <div className="mt-4">
        <p>{t("waitingOther")}</p>
        {details}
        <div className="mt-6">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => cancelCagnotte(cagnotte.id))}>
            {t("cancel")}
          </Button>
        </div>
        {messages}
      </div>
    );
  }

  if ((view === "open" || view === "closed" || view === "paidOut") && cagnotte) {
    const progress = progressPercent(cagnotte.collected_xof, cagnotte.goal_xof);
    const url = cagnotte.public_token ? cagnotteUrl(siteUrl, cagnotte.public_token) : null;
    const askedClose = cagnotte.my_requests.includes("close");
    const askedPayout = cagnotte.my_requests.includes("payout");
    return (
      <div className="mt-4">
        <p>{t(`status.${view}`, { date: day(cagnotte.closes_at) })}</p>
        {cagnotte.closed_reason === "separation" && <p className="mt-3 text-sm text-fg-muted">{t("separation")}</p>}
        {details}
        <p className="mt-6 font-serif text-3xl">{amount(cagnotte.collected_xof)}</p>
        <p className="text-sm text-fg-muted">{t("collected")}</p>
        {progress !== null && (
          <div className="mt-4 max-w-md">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label={t("progress", { percent: progress })}
              className="h-1.5 w-full bg-line"
            >
              <div className="h-full bg-fg" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-sm text-fg-muted">{t("progress", { percent: progress })}</p>
          </div>
        )}
        {cagnotte.paid_out_xof > 0 && <p className="mt-4 text-sm">{t("paidOut", { amount: amount(cagnotte.paid_out_xof) })}</p>}
        {cagnotte.payout_pending && <p className="mt-4 text-sm">{t("payoutPending")}</p>}

        {view === "open" && url && (
          <div className="mt-8 border-t border-line pt-6">
            <p className="text-sm font-medium">{t("share")}</p>
            <p className="mt-2 break-all text-sm">
              <a href={url} className="text-link underline-offset-4 hover:underline">
                {url}
              </a>
            </p>
            <p className="mt-3">
              <a href={whatsappShare(t("shareText", { title: cagnotte.title }), url)} target="_blank" rel="noopener noreferrer" className="text-sm text-link underline-offset-4 hover:underline">
                {t("shareWhatsapp")}
              </a>
            </p>
            <p className="mt-3 max-w-measure text-xs text-fg-muted">{t("shareHelp")}</p>
          </div>
        )}

        {view !== "paidOut" && cagnotte.closed_reason !== "separation" && (
          <div className="mt-8 flex flex-wrap gap-4">
            {!cagnotte.payout_pending && (
              <Button type="button" variant="secondary" disabled={pending || askedPayout} onClick={() => run(() => decideCagnotte(cagnotte.id, "payout"))}>
                {askedPayout ? t("payoutAsked") : t("askPayout")}
              </Button>
            )}
            {view === "open" && (
              <Button type="button" variant="secondary" disabled={pending || askedClose} onClick={() => run(() => decideCagnotte(cagnotte.id, "close"))}>
                {askedClose ? t("closeAsked") : t("askClose")}
              </Button>
            )}
          </div>
        )}
        {view !== "paidOut" && <p className="mt-3 max-w-measure text-xs text-fg-muted">{t("bothHelp", { percent: commissionPercent })}</p>}
        {view === "open" && minPayout > 0 && <p className="mt-1 max-w-measure text-xs text-fg-muted">{t("minPayoutHelp", { amount: amount(minPayout) })}</p>}
        {messages}

        {contributions.length > 0 && (
          <section aria-labelledby="contributions" className="mt-10">
            <h3 id="contributions" className="text-lg">
              {t("contributions")}
            </h3>
            <ul className="mt-4 border-t border-line">
              {contributions.map((c) => (
                <li key={c.id} className="border-b border-line py-4">
                  <p className="flex flex-wrap justify-between gap-4">
                    <span className="font-medium">{c.contributor_name ?? t("anonymous")}</span>
                    <span className="tabular-nums">{c.amount_xof === null ? t("hiddenAmount") : amount(c.amount_xof)}</span>
                  </p>
                  {c.message && <p className="mt-2 text-fg-muted">{c.message}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  if (!canPropose) return <p className="mt-4 max-w-measure text-sm text-fg-muted">{t("notYet")}</p>;

  return (
    <form onSubmit={submit} noValidate className="mt-4 grid gap-6">
      <p className="max-w-measure text-fg-muted">{t("intro")}</p>
      <label className="block">
        <span className="text-sm font-medium">{t("titleLabel")}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t("titleHelp")}</span>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} className={cn(fieldClass, "text-base")} />
      </label>
      <div className="grid gap-6 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">{t("goalLabel")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("goalHelp")}</span>
          <input value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} inputMode="numeric" maxLength={13} className={cn(fieldClass, "text-base")} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{t("closesLabel")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("closesHelp")}</span>
          <input type="date" value={draft.closesOn} min={today()} onChange={(e) => setDraft({ ...draft, closesOn: e.target.value })} className={cn(fieldClass, "text-base")} />
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium">{t("phoneLabel")}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t("phoneHelp")}</span>
        <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} inputMode="tel" maxLength={20} placeholder="+229 01 97 00 00 00" className={cn(fieldClass, "text-base")} />
      </label>
      <p className="max-w-measure border-l border-line pl-4 text-sm text-fg-muted">{t("fees", { percent: commissionPercent })}</p>
      <div>
        <Button type="submit" disabled={pending}>
          {t("propose")}
        </Button>
      </div>
      {messages}
    </form>
  );
}
