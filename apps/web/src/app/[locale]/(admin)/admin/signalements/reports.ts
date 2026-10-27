/** Décisions possibles sur un signalement (question 11, 27 octobre 2026). */
export const decisions = ["dismissed", "warning", "suspension", "exclusion"] as const;
export type Decision = (typeof decisions)[number];
