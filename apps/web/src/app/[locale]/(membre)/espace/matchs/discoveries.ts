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
 *   - waiting : ancien match encore en attente d'ouverture (depuis le 06/11/2026, chaque match
 *     s'ouvre aussitôt : il n'y a plus de choix à faire) ;
 *   - active : découverte ouverte (ou prolongée) ;
 *   - couple : découverte devenue couple ;
 *   - ended : mise en relation terminée (match expiré, découverte fermée ou arrivée à échéance).
 */
export type Section = "waiting" | "active" | "couple" | "ended";

export function sectionOf(row: DiscoveryRow, now: Date): Section {
  if (row.discovery_status === "active" || row.discovery_status === "extended") return "active";
  if (row.discovery_status === "continued") return "couple";
  if (row.match_status === "pending_choice" && now.getTime() < new Date(row.pending_expires_at).getTime()) {
    return "waiting";
  }
  return "ended";
}

export function groupBySection(rows: readonly DiscoveryRow[], now: Date): Record<Section, DiscoveryRow[]> {
  const out: Record<Section, DiscoveryRow[]> = { waiting: [], active: [], couple: [], ended: [] };
  for (const row of rows) out[sectionOf(row, now)].push(row);
  return out;
}

/** Jours restants (arrondis au jour supérieur, 0 si l'échéance est passée). */
export function daysLeft(until: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(until).getTime() - now.getTime()) / 86_400_000));
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

/**
 * Espace d'une découverte, étape par étape (audit UX du 3 novembre 2026) : onglets et guide.
 * Discuter, se rencontrer, puis décider ; le guide dit quoi faire maintenant et ouvre l'onglet utile.
 */
export const discoveryTabs = ["discussion", "dates", "photos", "decision"] as const;
export type DiscoveryTab = (typeof discoveryTabs)[number];

export type DiscoveryGuideKey = "writeFirst" | "planDate" | "decide" | "decideSoon" | "decided";
export type DiscoveryGuide = {
  key: DiscoveryGuideKey;
  tab: DiscoveryTab | null;
  steps: Record<"talk" | "meet" | "decide", "done" | "current" | "todo">;
};

/** Jours restants à partir desquels la décision passe en tête. */
export const DECIDE_SOON_DAYS = 3;

export function discoveryGuide(input: { sentMessages: number; dates: number; wantsToContinue: boolean; daysLeft: number }): DiscoveryGuide {
  const talked = input.sentMessages > 0;
  const met = input.dates > 0;
  const decided = input.wantsToContinue;
  const steps = {
    talk: talked ? "done" : "current",
    meet: met ? "done" : talked ? "current" : "todo",
    decide: decided ? "done" : met ? "current" : "todo",
  } as DiscoveryGuide["steps"];
  if (decided) return { key: "decided", tab: null, steps };
  if (input.daysLeft <= DECIDE_SOON_DAYS) return { key: "decideSoon", tab: "decision", steps: { ...steps, decide: "current" } };
  if (!talked) return { key: "writeFirst", tab: "discussion", steps };
  if (!met) return { key: "planDate", tab: "dates", steps };
  return { key: "decide", tab: "decision", steps };
}

/** Ligne de app.my_discovery_chats() : dernier message et messages non lus d'une discussion ouverte. */
export type ChatPreview = {
  discovery_id: string;
  conversation_id: string;
  last_body: string | null;
  last_is_system: boolean | null;
  last_from_me: boolean | null;
  last_at: string | null;
  unread: number;
};

/**
 * Liste des discussions façon WhatsApp (06/11/2026) : la plus récente en haut (dernier message,
 * sinon ouverture de la découverte).
 */
export function sortChats<T extends Pick<DiscoveryRow, "discovery_id" | "opened_at">>(
  rows: readonly T[],
  previews: readonly Pick<ChatPreview, "discovery_id" | "last_at">[],
): T[] {
  const last = new Map(previews.map((p) => [p.discovery_id, p.last_at]));
  const at = (r: T) => new Date(last.get(r.discovery_id ?? "") ?? r.opened_at ?? 0).getTime();
  return [...rows].sort((a, b) => at(b) - at(a));
}

/** Heure du dernier message : l'heure si c'est aujourd'hui, « hier », sinon la date. */
export type ChatTimeLabel = { kind: "time" | "yesterday" | "date"; date: Date };

export function chatTimeLabel(iso: string, now: Date, timeZone = "Africa/Porto-Novo"): ChatTimeLabel {
  const date = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  if (day(date) === day(now)) return { kind: "time", date };
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return { kind: "yesterday", date };
  return { kind: "date", date };
}
