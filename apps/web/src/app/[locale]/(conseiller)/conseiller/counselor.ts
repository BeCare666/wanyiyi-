/** Espace conseiller (section 7) : lignes lues avec le jeton du conseiller. */

/** Ligne de app.counselor_couples() : couple suivi pendant l'accès accordé, prénoms seulement. */
export type FollowedCouple = {
  couple_id: string;
  conversation_id: string | null;
  member_a: string;
  a_first_name: string;
  member_b: string;
  b_first_name: string;
  status: "active" | "paused" | "union_celebrated" | "separated" | "left";
  blocked: boolean;
  granted_at: string;
  include_history: boolean;
  last_activity_at: string;
  unread: number;
};

export type CounselorNote = { id: string; body: string; created_at: string };

/** Longueur d'une note privée (la base refuse au-delà). */
export const NOTE_MAX = 4000;

/** Note acceptable : texte non vide de 4 000 caractères au plus. */
export function noteBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" || text.length > NOTE_MAX ? null : text;
}
