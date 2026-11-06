"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { DEBATE_TOPICS } from "@/lib/topics";
import { cancelEvening, deleteDraft, runStep, setEventTopics } from "../actions";
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
  "invalid_topics",
  "not_editable",
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

/**
 * Quatre sujets de débat de la soirée (06/11/2026), les mêmes sur toutes les tables : proposés
 * d'office, l'équipe peut en changer jusqu'à la fin de la soirée. Quatre sujets différents.
 */
export function TopicsForm({ eventId, initial }: { eventId: string; initial: string[] }) {
  const t = useTranslations("Admin.evenings.topics");
  const tt = useTranslations("Topics");
  const [topics, setTopics] = useState<string[]>(initial.length === 4 ? initial : [...DEBATE_TOPICS.slice(0, 4)]);
  const [saved, setSaved] = useState(false);
  const { error, pending, run } = useAction();
  const duplicate = new Set(topics).size !== topics.length;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (duplicate) return;
        setSaved(false);
        run(() => setEventTopics(eventId, topics), () => setSaved(true));
      }}
      className="grid gap-6"
    >
      <ol className="grid gap-4 md:grid-cols-2">
        {topics.map((topic, i) => (
          <li key={i}>
            <label className="block">
              <span className="text-sm font-medium">{t("label", { number: i + 1 })}</span>
              <select
                value={topic}
                onChange={(e) => {
                  setSaved(false);
                  setTopics((list) => list.map((x, j) => (j === i ? e.target.value : x)));
                }}
                className={cn(fieldClass, "text-base")}
              >
                {DEBATE_TOPICS.map((key) => (
                  <option key={key} value={key}>
                    {tt(key)}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ol>
      {duplicate && (
        <p role="alert" className="border-l border-accent pl-5">
          {t("duplicate")}
        </p>
      )}
      <ErrorLine code={error} />
      {saved && !error && (
        <p role="status" className="text-sm text-fg-muted">
          {t("saved")}
        </p>
      )}
      <div>
        <Button type="submit" variant="secondary" disabled={pending || duplicate}>
          {t("save")}
        </Button>
      </div>
    </form>
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
