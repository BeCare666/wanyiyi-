/**
 * Minuteur de soirée sur tablette (note : « pilote les tours, signal visuel et sonore » ;
 * question 8 du 22 octobre 2026 : pas de pause). L'horaire de chaque tour est fixé par la base
 * au démarrage (app.start_timer) ; ce module dit seulement où en est la soirée à un instant donné.
 */

/** Ligne de app.evening_timer : horaire d'un tour, null tant que le minuteur n'est pas démarré. */
export type TimerRound = { round_number: number; started_at: string | null; ended_at: string | null };

export type TimerState =
  | { phase: "not_started" }
  | { phase: "before"; untilMs: number }
  | { phase: "round"; round: number; total: number; remainingMs: number }
  | { phase: "changeover"; nextRound: number; total: number; remainingMs: number }
  | { phase: "finished"; total: number };

/** Où en est la soirée : tour en cours, changement de table avant le suivant, ou fin. */
export function timerState(rounds: TimerRound[], now: Date): TimerState {
  const timed = rounds
    .filter((r): r is TimerRound & { started_at: string; ended_at: string } => r.started_at !== null && r.ended_at !== null)
    .sort((a, b) => a.round_number - b.round_number);
  if (timed.length === 0 || timed.length !== rounds.length) return { phase: "not_started" };
  const t = now.getTime();
  const total = timed.length;
  const first = new Date(timed[0]!.started_at).getTime();
  if (t < first) return { phase: "before", untilMs: first - t };
  for (const [i, r] of timed.entries()) {
    const start = new Date(r.started_at).getTime();
    const end = new Date(r.ended_at).getTime();
    if (t >= start && t < end) return { phase: "round", round: r.round_number, total, remainingMs: end - t };
    const next = timed[i + 1];
    if (next && t >= end && t < new Date(next.started_at).getTime()) {
      return { phase: "changeover", nextRound: next.round_number, total, remainingMs: new Date(next.started_at).getTime() - t };
    }
  }
  return { phase: "finished", total };
}

/** Clé d'une étape du minuteur : un signal est donné quand elle change. */
export function stepKey(state: TimerState): string {
  if (state.phase === "round") return `round-${state.round}`;
  if (state.phase === "changeover") return `changeover-${state.nextRound}`;
  return state.phase;
}

/** Temps restant affiché en minutes et secondes (arrondi à la seconde supérieure). */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
