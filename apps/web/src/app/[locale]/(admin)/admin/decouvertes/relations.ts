/**
 * Matchs, découvertes et couples côté administration (11.2-6 et 11.2-7) : lignes de
 * app.admin_list('discoveries') et app.admin_list('couples'), et colonnes de leurs exports.
 */

type Pair = {
  a_first_name: string | null;
  a_last_name: string | null;
  a_number: string | null;
  b_first_name: string | null;
  b_last_name: string | null;
  b_number: string | null;
};

export type AdminDiscoveryRow = Pair & {
  id: string;
  event_starts_at: string;
  match_status: "pending_choice" | "discovery_open" | "expired" | "closed";
  announced_at: string | null;
  pending_expires_at: string | null;
  discovery_id: string | null;
  discovery_status: "active" | "extended" | "continued" | "closed" | "expired" | null;
  opened_at: string | null;
  ends_at: string | null;
  extended: boolean;
  total: number;
};

export type AdminCoupleRow = Pair & {
  id: string;
  status: "active" | "paused" | "union_celebrated" | "separated" | "left";
  created_at: string;
  last_activity_at: string;
  ended_at: string | null;
  counselor_id: string | null;
  counselor_name: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  inactive_days: number;
  total: number;
};

/** Les deux personnes : « Prénom Nom (numéro) et Prénom Nom (numéro) ». */
export function pairLabel(row: Pair): [string, string] {
  const one = (first: string | null, last: string | null, n: string | null) =>
    [[first, last].filter(Boolean).join(" ") || "·", n ? `(${n})` : ""].filter(Boolean).join(" ");
  return [one(row.a_first_name, row.a_last_name, row.a_number), one(row.b_first_name, row.b_last_name, row.b_number)];
}

/** Échéance utile : fin de la découverte si elle est ouverte, sinon fin de l'attente du match. */
export function deadlineOf(row: Pick<AdminDiscoveryRow, "discovery_status" | "ends_at" | "match_status" | "pending_expires_at">): string | null {
  if (row.discovery_status === "active" || row.discovery_status === "extended") return row.ends_at;
  if (row.match_status === "pending_choice") return row.pending_expires_at;
  return null;
}

/** Seuil d'alerte d'inactivité d'un couple (9.5). */
export const INACTIVITY_ALERT_DAYS = 60;

export const discoveryExportColumns = ["event_date", "member_a", "member_b", "match_status", "discovery_status", "deadline", "extended"] as const;
export const coupleExportColumns = ["member_a", "member_b", "status", "counselor", "created_at", "last_activity_at", "inactive_days"] as const;
