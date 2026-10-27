/**
 * Mes matchs et découvertes (section 9.4 ; question 2 de la phase 3). Lignes de
 * app.my_discoveries() rangées par section ; jamais le choix ni la décision de l'autre personne.
 */

export type MatchStatus = "pending_choice" | "discovery_open" | "expired" | "closed";
export type DiscoveryStatus = "active" | "extended" | "continued" | "closed" | "expired";

export type DiscoveryRow = {
  match_id: string;
  discovery_id: string | null;
  partner_first_name: string;
  announced_at: string;
  match_status: MatchStatus;
  pending_expires_at: string;
  chosen_by_me: boolean;
  discovery_status: DiscoveryStatus | null;
  opened_at: string | null;
  ends_at: string | null;
  extended: boolean;
  i_want_to_continue: boolean;
  i_want_extension: boolean;
  free_slots: number;
};

/**
 * Sections de la page :
 *   - toChoose : match en attente que le membre n'a pas encore choisi ;
 *   - waiting : match qu'il a choisi, en attente de l'autre (sans dire pourquoi) ;
 *   - active : découverte ouverte (ou prolongée) ;
 *   - couple : découverte devenue couple ;
 *   - ended : mise en relation terminée (match expiré, découverte fermée ou arrivée à échéance).
 */
export type Section = "toChoose" | "waiting" | "active" | "couple" | "ended";

export function sectionOf(row: DiscoveryRow, now: Date): Section {
  if (row.discovery_status === "active" || row.discovery_status === "extended") return "active";
  if (row.discovery_status === "continued") return "couple";
  if (row.match_status === "pending_choice" && now.getTime() < new Date(row.pending_expires_at).getTime()) {
    return row.chosen_by_me ? "waiting" : "toChoose";
  }
  return "ended";
}

export function groupBySection(rows: readonly DiscoveryRow[], now: Date): Record<Section, DiscoveryRow[]> {
  const out: Record<Section, DiscoveryRow[]> = { toChoose: [], waiting: [], active: [], couple: [], ended: [] };
  for (const row of rows) out[sectionOf(row, now)].push(row);
  return out;
}

/** Jours restants (arrondis au jour supérieur, 0 si l'échéance est passée). */
export function daysLeft(until: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(until).getTime() - now.getTime()) / 86_400_000));
}

/** Le membre peut-il choisir un match maintenant ? (place libre ; la base revérifie tout) */
export function canChoose(row: DiscoveryRow): boolean {
  return row.free_slots > 0;
}

/** Prolongation encore possible : une seule, découverte pas encore prolongée. */
/** La prolongation se demande pendant les 4 derniers jours seulement (question 3, 27 octobre 2026). */
export const EXTENSION_WINDOW_DAYS = 4;

/**
 * Bouton de prolongation : découverte active, pas encore prolongée, pendant ses 4 derniers jours ;
 * toujours affiché pour retirer une demande déjà faite.
 */
export function canAskExtension(row: DiscoveryRow, now: Date): boolean {
  if (row.discovery_status !== "active" || row.extended || !row.ends_at) return false;
  const end = new Date(row.ends_at).getTime();
  if (now.getTime() >= end) return false;
  return row.i_want_extension || now.getTime() >= end - EXTENSION_WINDOW_DAYS * 86_400_000;
}
