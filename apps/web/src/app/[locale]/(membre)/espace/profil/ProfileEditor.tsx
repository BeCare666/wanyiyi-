"use client";

import { INDIFFERENT, type CatalogCategory } from "@wanyiyi/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { memberHome } from "@/components/member/memberNav";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/cn";
import { saveAnswer, setDealbreaker } from "./actions";
import {
  type Answers,
  canBeDealbreaker,
  categoryOf,
  isMultiple,
  isProfileComplete,
  maxDealbreakers,
  progress,
  type Side,
  sides,
  stepsFor,
  toggleValue,
} from "./profile";
import { type ProfileText, TextsStep } from "./TextsStep";

type Status = "saving" | "saved" | "error" | "too_many" | null;

/**
 * Profil en étapes (section 8) : deux onglets, barre de progression, étiquettes sélectionnables,
 * enregistrement automatique à chaque choix.
 */
export function ProfileEditor({
  initialAnswers,
  initialDealbreakers,
  texts,
}: {
  initialAnswers: Answers;
  initialDealbreakers: string[];
  texts: Record<string, ProfileText>;
}) {
  const t = useTranslations("Member.profile");
  const tp = useTranslations("Profile");
  const [side, setSide] = useState<Side>("self");
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState(initialAnswers);
  const [dealbreakers, setDealbreakers] = useState(initialDealbreakers);
  const [written, setWritten] = useState(Object.values(texts).filter((x) => x.body.trim() !== "").length);
  const [status, setStatus] = useState<Status>(null);
  // Message de fin (30 octobre 2026) : seulement quand le profil devient complet pendant la visite
  const [completeAtStart] = useState(() => isProfileComplete(initialAnswers, written));
  const justCompleted = !completeAtStart && isProfileComplete(answers, written);

  const steps = stepsFor(side);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const { done, total } = progress(side, answers, written);

  function chooseSide(next: Side) {
    setSide(next);
    setStepIndex(0);
    setStatus(null);
  }

  function choose(category: CatalogCategory, value: string) {
    const before = answers[side][category.key] ?? [];
    const next = toggleValue(side, category, before, value);
    if (next.length === before.length && next.every((v, i) => v === before[i])) return;
    const apply = (values: string[]) => setAnswers((a) => ({ ...a, [side]: { ...a[side], [category.key]: values } }));
    apply(next);
    if (side === "seeking" && !canBeDealbreaker(next)) setDealbreakers((d) => d.filter((c) => c !== category.key));
    setStatus("saving");
    void saveAnswer(side, category.key, next).then((ok) => {
      if (!ok) apply(before);
      setStatus(ok ? "saved" : "error");
    });
  }

  function toggleDealbreaker(category: string, on: boolean) {
    setStatus("saving");
    void setDealbreaker(category, on).then((result) => {
      if (result === "added") setDealbreakers((d) => [...d, category]);
      if (result === "removed") setDealbreakers((d) => d.filter((c) => c !== category));
      setStatus(result === "added" || result === "removed" ? "saved" : result === "too_many" ? "too_many" : "error");
    });
  }

  return (
    <div className="mt-10">
      <div role="tablist" aria-label={t("tabsLabel")} className="grid grid-cols-2 gap-2 sm:max-w-md">
        {sides.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={side === s}
            onClick={() => chooseSide(s)}
            className={cn("min-h-12 rounded-sm border px-3 text-sm", side === s ? "border-fg text-fg" : "border-line text-fg-muted")}
          >
            {t(`tabs.${s}`)}
          </button>
        ))}
      </div>

      <div className="mt-8" role="tabpanel">
        <div className="flex flex-wrap items-baseline justify-between gap-4 text-sm">
          <p className="eyebrow">{t("step", { current: stepIndex + 1, total: steps.length })}</p>
          <p className="text-fg-muted">{t("progress", { done, total })}</p>
        </div>
        <div className="mt-3 h-1 w-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t("progressLabel")}>
          <div className="h-1 bg-accent transition-[width]" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
        </div>

        <h2 className="mt-8 text-3xl">{t(`steps.${step.key}`)}</h2>
        {side === "seeking" && step.key === "situation" && (
          <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("dealbreakersHelp", { max: maxDealbreakers })}</p>
        )}

        {step.key === "words" ? (
          <TextsStep texts={texts} onWrittenChange={setWritten} />
        ) : (
          <div className="mt-6">
            {step.categories.map((key) => {
              const category = categoryOf(key)!;
              const values = answers[side][key] ?? [];
              const options = side === "seeking" && !category.options.includes(INDIFFERENT) ? [...category.options, INDIFFERENT] : category.options;
              const isDealbreaker = dealbreakers.includes(key);
              return (
                <fieldset key={key} className="border-t border-line py-6">
                  <legend className="float-left w-full font-medium">
                    {tp(`${key}.title`)}
                    {category.optional && <span className="ml-2 text-sm font-normal text-fg-muted">{t("optional")}</span>}
                  </legend>
                  <p className="clear-left pt-1 text-sm text-fg-muted">
                    {[
                      isMultiple(side, category) ? t("several") : t("one"),
                      side === "self" && category.min !== undefined ? t("between", { min: category.min, max: category.max ?? category.min }) : null,
                      category.visibility === "after_match" ? t("afterMatch") : category.visibility === "team" ? t("teamOnly") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {options.map((option) => {
                      const selected = values.includes(option);
                      return (
                        <li key={option}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => choose(category, option)}
                            className={cn(
                              "min-h-11 rounded-full border px-4 text-sm transition-colors",
                              selected ? "border-fg bg-fg text-bg" : "border-line-strong text-fg hover:border-fg",
                            )}
                          >
                            {option === INDIFFERENT && !category.options.includes(INDIFFERENT) ? t("indifferent") : tp(`${key}.options.${option}`)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {side === "seeking" && (
                    <label className={cn("mt-4 flex min-h-11 items-center gap-3 text-sm", !canBeDealbreaker(values) && "opacity-50")}>
                      <input
                        type="checkbox"
                        checked={isDealbreaker}
                        disabled={!canBeDealbreaker(values) || (!isDealbreaker && dealbreakers.length >= maxDealbreakers)}
                        onChange={(e) => toggleDealbreaker(key, e.target.checked)}
                        className="size-4 accent-[var(--accent)]"
                      />
                      <span>{t("dealbreaker")}</span>
                    </label>
                  )}
                </fieldset>
              );
            })}
          </div>
        )}

        <p role="status" aria-live="polite" className={cn("mt-6 min-h-6 text-sm", status === "error" || status === "too_many" ? "text-fg" : "text-fg-muted")}>
          {status === "saving" && t("saving")}
          {status === "saved" && t("saved")}
          {status === "error" && t("error")}
          {status === "too_many" && t("tooMany", { max: maxDealbreakers })}
        </p>

        {justCompleted && (
          <div role="status" className="mt-2 border border-accent bg-bg-soft p-6">
            <p className="font-serif text-2xl">{t("completed.title")}</p>
            <p className="mt-3 max-w-measure text-fg-muted">{t("completed.text")}</p>
            <ButtonLink href={memberHome} className="mt-5">
              {t("completed.action")}
            </ButtonLink>
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-between gap-4 border-t border-line pt-6">
          <Button type="button" variant="secondary" disabled={stepIndex === 0} onClick={() => setStepIndex((i) => i - 1)}>
            {t("previous")}
          </Button>
          {stepIndex < steps.length - 1 ? (
            <Button type="button" onClick={() => setStepIndex((i) => i + 1)}>
              {t("next")}
            </Button>
          ) : side === "self" ? (
            <Button type="button" onClick={() => chooseSide("seeking")}>
              {t("toSeeking")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
