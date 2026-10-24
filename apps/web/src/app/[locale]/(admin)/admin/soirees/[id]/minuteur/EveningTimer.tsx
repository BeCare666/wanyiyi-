"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { startTimer } from "../../actions";
import { clock, stepKey, type TimerRound, timerState } from "../../timer";

const knownErrors = new Set(["already_started", "invalid_status", "not_prepared", "not_found", "forbidden", "unavailable"]);

/** Signal sonore : deux bips courts, produits par le navigateur (aucun fichier). */
function beep(context: AudioContext) {
  for (const offset of [0, 0.35]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, context.currentTime + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.25);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(context.currentTime + offset);
    oscillator.stop(context.currentTime + offset + 0.3);
  }
}

/**
 * Minuteur de la tablette : tour en cours et temps restant, signal visuel et sonore à chaque
 * changement d'étape (début d'un tour, changement de table, fin). Sans pause (question 8).
 * Le navigateur n'autorise le son qu'après un geste : bouton « Activer le son ».
 */
export function EveningTimer({ eventId, rounds, canStart }: { eventId: string; rounds: TimerRound[]; canStart: boolean }) {
  const t = useTranslations("Admin.evenings.timer");
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [flash, setFlash] = useState(false);
  const [sound, setSound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const audio = useRef<AudioContext | null>(null);
  const lastStep = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 250);
    return () => clearInterval(id);
  }, []);

  const state = timerState(rounds, now);
  const key = stepKey(state);

  // Signal à chaque changement d'étape (pas au premier affichage)
  useEffect(() => {
    const previous = lastStep.current;
    lastStep.current = key;
    if (previous === null || previous === key) return;
    setFlash(true);
    if (audio.current) beep(audio.current);
    const id = setTimeout(() => setFlash(false), 2000);
    return () => clearTimeout(id);
  }, [key]);

  function enableSound() {
    audio.current ??= new AudioContext();
    void audio.current.resume();
    beep(audio.current);
    setSound(true);
  }

  function start() {
    setError(null);
    if (!audio.current) enableSound();
    startTransition(async () => {
      const result = await startTimer(eventId);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  }

  return (
    <div className={cn("mt-10 rounded-sm border border-line px-6 py-12 text-center transition-colors", flash && "bg-accent text-accent-fg")}>
      {state.phase === "not_started" ? (
        canStart ? (
          <>
            <p className="text-fg-muted">{t("startHelp")}</p>
            <Button type="button" disabled={pending} onClick={start} className="mt-8">
              {t("start")}
            </Button>
          </>
        ) : (
          <p className="text-fg-muted">{t("notInProgress")}</p>
        )
      ) : (
        <>
          <p role="status" className="text-xl">
            {state.phase === "before"
              ? t("before")
              : state.phase === "round"
                ? t("round", { round: state.round, total: state.total })
                : state.phase === "changeover"
                  ? t("changeover", { round: state.nextRound })
                  : t("finished")}
          </p>
          {state.phase !== "finished" && (
            <p className="mt-6 font-serif text-[6rem] leading-none tabular-nums" aria-label={t("remaining")}>
              {clock(state.phase === "before" ? state.untilMs : state.remainingMs)}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-6 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
      {state.phase !== "finished" && (
        <Button type="button" variant="secondary" onClick={enableSound} disabled={sound} className="mt-10">
          {sound ? t("soundOn") : t("sound")}
        </Button>
      )}
    </div>
  );
}
