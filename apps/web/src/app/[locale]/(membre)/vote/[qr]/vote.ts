/** Tour du membre pendant la soirée (GET /vote/:qr), sans aucun prénom. */
export type Round = { round_number: number; is_pause: boolean; my_choice: "yes" | "no" | null };

/** Personne rencontrée à un tour (GET /vote/:qr/rounds/:round) : prénom seulement. */
export type Partner = { first_name: string | null; table_number: number; my_choice: "yes" | "no" | null };

export const criteria = ["respect", "punctuality", "seriousness"] as const;
export type Criterion = (typeof criteria)[number];

export type VoteInput = { choice: "yes" | "no" } & Partial<Record<Criterion, number | null>>;

/** Les codes QR sont générés en hexadécimal par la base (prepare_evening). */
export function isQrToken(value: string): boolean {
  return /^[0-9a-f]{16,128}$/.test(value);
}

/** Vote valide pour l'API : choix oui ou non, notes entières de 1 à 5, absentes si non données. */
export function parseVote(input: VoteInput): VoteInput | null {
  if (input.choice !== "yes" && input.choice !== "no") return null;
  const vote: VoteInput = { choice: input.choice };
  for (const key of criteria) {
    const value = input[key];
    if (value === null || value === undefined) continue;
    if (!Number.isInteger(value) || value < 1 || value > 5) return null;
    vote[key] = value;
  }
  return vote;
}

/** Tour proposé à l'ouverture : le premier sans vote (hors pause), sinon le dernier. */
export function defaultRound(rounds: Round[]): number | null {
  const open = rounds.find((r) => !r.is_pause && r.my_choice === null);
  return (open ?? rounds[rounds.length - 1])?.round_number ?? null;
}
