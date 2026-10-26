/** Conseillers (11.2-8 ; question 9 a) : mêmes contrôles que app.admin_create_counselor. */

export const counselorLanguages = ["fr", "en", "yo"] as const;
export type CounselorLanguage = (typeof counselorLanguages)[number];

export type CounselorInput = { name: string; bio: string; languages: string[]; maxCouples: number };
export type CounselorError = "name_required" | "languages_required" | "invalid_capacity";

export type CounselorRow = {
  user_id: string;
  display_name: string;
  bio: string | null;
  languages: CounselorLanguage[];
  max_couples: number;
  is_available: boolean;
  member_number: string | null;
  active_couples: number;
};

export function checkCounselor(input: CounselorInput): CounselorError | null {
  const name = input.name.trim();
  if (name === "" || name.length > 80) return "name_required";
  if (!input.languages.some((l) => (counselorLanguages as readonly string[]).includes(l))) return "languages_required";
  if (!Number.isInteger(input.maxCouples) || input.maxCouples < 1 || input.maxCouples > 100) return "invalid_capacity";
  return null;
}

/** Paramètres de la base : langues hors liste écartées, texte de présentation facultatif. */
export function counselorParams(input: CounselorInput) {
  return {
    p_display_name: input.name.trim(),
    p_bio: input.bio.trim().slice(0, 1000) || null,
    p_languages: counselorLanguages.filter((l) => input.languages.includes(l)),
    p_max_couples: input.maxCouples,
  };
}

/** Charge : couples en cours sur le maximum. */
export function isFull(row: Pick<CounselorRow, "active_couples" | "max_couples">): boolean {
  return row.active_couples >= row.max_couples;
}

/** Demande acceptée par les deux membres, en attente d'un conseiller (app.admin_counselor_requests). */
export type CounselorRequest = {
  access_id: string;
  couple_id: string;
  accepted_at: string;
  include_history: boolean;
  a_first_name: string | null;
  a_number: string | null;
  b_first_name: string | null;
  b_number: string | null;
};

/** Conseillers proposés pour une attribution : disponibles et pas complets. */
export function assignable(rows: readonly CounselorRow[]): CounselorRow[] {
  return rows.filter((r) => r.is_available && !isFull(r));
}
