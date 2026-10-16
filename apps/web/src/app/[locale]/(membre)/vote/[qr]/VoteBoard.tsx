"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { loadPartner, saveVote } from "./actions";
import { type Criterion, criteria, defaultRound, type Partner, type Round } from "./vote";

const knownErrors = new Set(["outside_evening", "not_in_round", "pause_round", "unavailable"]);

/**
 * Vote d'un tour : choix du tour, prénom de la personne rencontrée, « oui » ou « non »,
 * appréciation facultative (respect, ponctualité, sérieux) visible uniquement par l'équipe.
 */
export function VoteBoard({ qr, initialRounds }: { qr: string; initialRounds: Round[] }) {
  const t = useTranslations("Vote");
  const [rounds, setRounds] = useState(initialRounds);
  const [selected, setSelected] = useState<number | null>(() => defaultRound(initialRounds));

  const current = rounds.find((r) => r.round_number === selected) ?? null;

  const markVoted = (roundNumber: number, choice: "yes" | "no") =>
    setRounds((list) => list.map((r) => (r.round_number === roundNumber ? { ...r, my_choice: choice } : r)));

  return (
    <div className="mt-10">
      <h2 className="eyebrow">{t("rounds")}</h2>
      <ul className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
        {rounds.map((round) => {
          const active = round.round_number === selected;
          const done = round.my_choice !== null;
          return (
            <li key={round.round_number}>
              <button
                type="button"
                onClick={() => setSelected(round.round_number)}
                aria-pressed={active}
                aria-label={`${t("round", { number: round.round_number })}. ${
                  round.is_pause ? t("pause") : done ? t("voted") : t("notVoted")
                }`}
                className={cn(
                  "relative flex h-14 w-full flex-col items-center justify-center rounded-sm border text-sm",
                  active ? "border-fg bg-fg text-bg" : "border-line text-fg",
                  round.is_pause && !active && "text-fg-muted",
                )}
              >
                <span className="font-serif text-xl leading-none">{round.round_number}</span>
                {round.is_pause ? (
                  <span className="mt-1 text-[0.625rem] uppercase tracking-wider">{t("pause")}</span>
                ) : (
                  done && <CheckIcon size={12} weight="regular" aria-hidden="true" className="mt-1" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {current && (
        <section aria-live="polite" className="mt-10 border-t border-line pt-8">
          {current.is_pause ? (
            <p className="text-fg-muted">{t("pauseText")}</p>
          ) : (
            <RoundPanel key={current.round_number} qr={qr} round={current} onSaved={markVoted} />
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Un tour (hors pause) : prénom de la personne rencontrée et vote déjà donné.
 * Remonté à chaque changement de tour (clé), donc toujours sans état du tour précédent.
 */
function RoundPanel({
  qr,
  round,
  onSaved,
}: {
  qr: string;
  round: Round;
  onSaved: (roundNumber: number, choice: "yes" | "no") => void;
}) {
  const t = useTranslations("Vote");
  const [partner, setPartner] = useState<Partner | null>(null);
  const [choice, setChoice] = useState<"yes" | "no" | null>(round.my_choice ?? null);
  const [scores, setScores] = useState<Partial<Record<Criterion, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    startLoading(async () => {
      const result = await loadPartner(qr, round.round_number);
      if (!result.ok) return setError(result.error);
      setPartner(result.data);
      setChoice(result.data?.my_choice ?? null);
    });
  }, [qr, round.round_number]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!choice) return setError("choose");
    setError(null);
    setSaved(false);
    startSaving(async () => {
      const result = await saveVote(qr, round.round_number, { choice, ...scores });
      if (!result.ok) return setError(result.error);
      setSaved(true);
      onSaved(round.round_number, choice);
    });
  }

  function clearScore(criterion: Criterion) {
    setScores((s) => {
      const next = { ...s };
      delete next[criterion];
      return next;
    });
  }

  const errorText =
    error === "choose" ? t("chooseFirst") : error ? t(`errors.${knownErrors.has(error) ? error : "generic"}`) : null;

  return loading || !partner ? (
    errorText ? (
      <p role="alert" className="border-l border-accent pl-5 text-fg">
        {errorText}
      </p>
    ) : (
      <p className="text-fg-muted" aria-busy="true">
        {t("round", { number: round.round_number })}
      </p>
    )
  ) : (
    <form onSubmit={submit}>
      <p className="font-serif text-2xl leading-snug">
        {t("partner", { number: round.round_number, table: partner.table_number, name: partner.first_name ?? "" })}
      </p>

      <fieldset className="mt-8">
        <legend className="sr-only">{t("title")}</legend>
        <div className="grid gap-3">
          {(["yes", "no"] as const).map((value) => (
            <label
              key={value}
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-4 rounded-sm border px-5",
                choice === value ? "border-fg bg-bg-soft" : "border-line",
              )}
            >
              <input
                type="radio"
                name="choice"
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
                className="size-4 accent-[var(--accent)]"
              />
              <span>{t(value)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-10">
        <legend className="eyebrow">{t("feedback")}</legend>
        <p className="mt-2 text-sm text-fg-muted">{t("feedbackHelp")}</p>
        {criteria.map((criterion) => (
          <div key={criterion} className="mt-6">
            <p id={`critere-${criterion}`} className="flex items-baseline justify-between text-sm">
              <span>{t(`criteria.${criterion}`)}</span>
              {scores[criterion] && (
                <button
                  type="button"
                  onClick={() => clearScore(criterion)}
                  className="text-xs text-link underline-offset-4 hover:underline"
                >
                  {t("clear")}
                </button>
              )}
            </p>
            <div role="radiogroup" aria-labelledby={`critere-${criterion}`} className="mt-2 grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((value) => {
                const on = scores[criterion] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={t("score", { value })}
                    onClick={() => setScores((s) => ({ ...s, [criterion]: value }))}
                    className={cn(
                      "h-11 rounded-sm border text-sm",
                      on ? "border-fg bg-fg text-bg" : "border-line text-fg",
                    )}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>

      {errorText && (
        <p role="alert" className="mt-8 border-l border-accent pl-5 text-fg">
          {errorText}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-8 border-l border-fg pl-5 text-fg">
          {t("saved")}
        </p>
      )}
      <Button type="submit" disabled={saving} className="mt-10 w-full">
        {t("submit")}
      </Button>
    </form>
  );
}
