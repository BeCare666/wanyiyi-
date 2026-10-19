/** États d'un membre (enum app.member_status). */
export const memberStatuses = ["registering", "pending_verification", "to_correct", "verified", "suspended", "excluded", "deleted"] as const;
export type MemberStatus = (typeof memberStatuses)[number];

/** Rôles (enum app.role). */
export const roles = ["member", "counselor", "moderator", "admin", "super_admin"] as const;
export type Role = (typeof roles)[number];

export const sexes = ["female", "male"] as const;
export type Sex = (typeof sexes)[number];

/** Ligne de app.admin_members() ; « total » : nombre de lignes du filtre, toutes pages. */
export type MemberRow = {
  user_id: string;
  member_number: string | null;
  phone: string | null;
  role: Role;
  first_name: string | null;
  last_name: string | null;
  sex: Sex | null;
  birth_date: string | null;
  city: string | null;
  status: MemberStatus | null;
  created_at: string;
  evenings_attended: number;
  matches: number;
  total: number;
};

/** Fiche de app.admin_member(). */
export type MemberCard = {
  user_id: string;
  member_number: string | null;
  phone: string | null;
  role: Role;
  locale: "fr" | "en" | "yo";
  consent_at: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  sex: Sex | null;
  birth_date: string | null;
  city: string | null;
  status: MemberStatus | null;
  journey_stage: string | null;
  evenings_blocked_until: string | null;
  verification_id: string | null;
  verification_status: "pending" | "to_correct" | "approved" | "rejected" | null;
};

/** Ligne de app.member_history(). */
export type HistoryRow = { at: string | null; kind: string; detail: Record<string, unknown> };

export const PAGE_SIZE = 50;

export type MemberQuery = { search: string; status: MemberStatus | null; role: Role | null; sex: Sex | null; page: number };

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(list: readonly T[], v: string): T | null => (list as readonly string[]).includes(v) ? (v as T) : null;

/** Filtres reflétés dans l'adresse (11.3) : ?q=, ?etat=, ?role=, ?sexe=, ?page=. Valeurs inconnues ignorées. */
export function parseMemberQuery(params: Params): MemberQuery {
  const page = Number.parseInt(first(params.page), 10);
  return {
    search: first(params.q).trim().slice(0, 100),
    status: oneOf(memberStatuses, first(params.etat)),
    role: oneOf(roles, first(params.role)),
    sex: oneOf(sexes, first(params.sexe)),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Paramètres de app.admin_members() pour une requête. */
export function memberRpcArgs(query: MemberQuery) {
  return {
    p_search: query.search || null,
    p_status: query.status,
    p_role: query.role,
    p_sex: query.sex,
    p_limit: PAGE_SIZE,
    p_offset: (query.page - 1) * PAGE_SIZE,
  };
}

/** Paramètres d'adresse d'une requête (sans les valeurs vides), pour les liens de pagination. */
export function memberQueryParams(query: MemberQuery, page = query.page): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.search) out.q = query.search;
  if (query.status) out.etat = query.status;
  if (query.role) out.role = query.role;
  if (query.sex) out.sexe = query.sex;
  if (page > 1) out.page = String(page);
  return out;
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** Actions possibles selon l'état du membre et les permissions de la personne connectée. */
export function availableActions(card: Pick<MemberCard, "user_id" | "status">, viewerId: string, canManageRoles: boolean) {
  const self = card.user_id === viewerId;
  const hasProfile = card.status !== null;
  const closed = card.status === "excluded" || card.status === "deleted";
  return {
    suspend: hasProfile && !self && !closed && card.status !== "suspended",
    reactivate: card.status === "suspended",
    exclude: hasProfile && !self && !closed,
    blockEvenings: hasProfile && !closed,
    role: canManageRoles && !self,
  };
}

/** Clé de traduction d'une ligne d'historique (Admin.members.history.kinds), « other » sinon. */
const historyKinds = [
  "account.created",
  "verification.pending",
  "verification.to_correct",
  "verification.approved",
  "verification.rejected",
  "evening.booked",
  "evening.confirmed",
  "evening.checked_in",
  "evening.cancelled",
  "evening.released",
  "evening.no_show",
  "evening.waitlisted",
  "match",
  "sanction.warning",
  "sanction.suspension",
  "sanction.exclusion",
  "payment.pending",
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
  "payment.cancelled",
  "role.changed",
  "member.reactivated",
  "member.evenings_blocked",
] as const;
export type HistoryKey = (typeof historyKinds)[number] | "other";

export function historyKey(kind: string): string {
  return (historyKinds as readonly string[]).includes(kind) ? kind.replace(/\./g, "_") : "other";
}
