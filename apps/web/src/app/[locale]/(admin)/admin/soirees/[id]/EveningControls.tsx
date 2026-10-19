"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cancelEvening, checkIn, deleteDraft, runStep } from "../actions";
import type { EveningStep } from "../evenings";

const knownErrors = new Set([
  "venue_required",
  "starts_in_past",
  "not_draft",
  "already_prepared",
  "not_prepared",
  "not_enough_participants",
  "invalid_status",
  "evening_not_finished",
  "not_confirmed",
  "member_inactive",
  "not_found",
  "forbidden",
  "unavailable",
]);

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      if (after) after();
      else router.refresh();
    });
  };
  return { error, pending, run, router };
}

function ErrorLine({ code }: { code: string | null }) {
  const t = useTranslations("Admin.evenings.errors");
  if (!code) return null;
  return (
    <p role="alert" className="mt-4 border-l border-accent pl-5">
      {t(code)}
    </p>
  );
}

/**
 * Étape suivante du déroulé, avec seconde confirmation : chaque étape est sans retour
 * (publication visible des membres, rotation figée, votes clos, matchs calculés).
 */
export function StepButton({ eventId, step }: { eventId: string; step: EveningStep }) {
  const t = useTranslations("Admin.evenings.steps");
  const [confirming, setConfirming] = useState(false);
  const { error, pending, run } = useAction();

  return (
    <div>
      <p className="max-w-measure text-fg-muted">{t(`${step}.help`)}</p>
      {confirming && (
        <p role="alert" className="mt-4 border-l border-accent pl-5">
          {t(`${step}.confirm`)}
        </p>
      )}
      <ErrorLine code={error} />
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            setConfirming(false);
            run(() => runStep(eventId, step));
          }}
        >
          {confirming ? t("confirmButton") : t(`${step}.button`)}
        </Button>
        {confirming && (
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
            {t("cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Suppression d'un brouillon, avec seconde confirmation. */
export function DeleteDraftButton({ eventId }: { eventId: string }) {
  const t = useTranslations("Admin.evenings.delete");
  const [confirming, setConfirming] = useState(false);
  const { error, pending, run, router } = useAction();

  return (
    <div>
      {confirming && (
        <p role="alert" className="border-l border-accent pl-5">
          {t("confirm")}
        </p>
      )}
      <ErrorLine code={error} />
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        className="mt-4"
        onClick={() => {
          if (!confirming) return setConfirming(true);
          setConfirming(false);
          run(() => deleteDraft(eventId), () => router.push("/admin/soirees"));
        }}
      >
        {confirming ? t("confirmButton") : t("button")}
      </Button>
    </div>
  );
}

/** Pointage à l'entrée d'un participant confirmé. */
export function CheckInButton({ eventId, userId, name }: { eventId: string; userId: string; name: string }) {
  const t = useTranslations("Admin.evenings.participants");
  const { error, pending, run } = useAction();
  return (
    <span className="inline-flex flex-col items-start md:items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => checkIn(eventId, userId))}
        aria-label={t("checkInLabel", { name })}
        className="inline-flex min-h-10 items-center rounded-sm border border-fg px-4 text-sm disabled:opacity-50"
      >
        {t("checkIn")}
      </button>
      <ErrorLine code={error} />
    </span>
  );
}

/** Annulation d'une soirée publiée, avec seconde confirmation (remboursement des paiements reçus). */
export function CancelEveningButton({ eventId }: { eventId: string }) {
  const t = useTranslations("Admin.evenings.cancel");
  const [confirming, setConfirming] = useState(false);
  const { error, pending, run } = useAction();

  return (
    <div>
      <p className="max-w-measure text-fg-muted">{t("help")}</p>
      {confirming && (
        <p role="alert" className="mt-4 border-l border-accent pl-5">
          {t("confirm")}
        </p>
      )}
      <ErrorLine code={error} />
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            setConfirming(false);
            run(() => cancelEvening(eventId));
          }}
        >
          {confirming ? t("confirmButton") : t("button")}
        </Button>
        {confirming && (
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
            {t("keep")}
          </Button>
        )}
      </div>
    </div>
  );
}
