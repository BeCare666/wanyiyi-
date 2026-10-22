import { PAGE_SIZE } from "../membres/members";

/** États d'un paiement (enum app.payment_status). */
export const paymentStatuses = ["pending", "succeeded", "failed", "refunded", "cancelled"] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

/** Objets d'un paiement (enum app.payment_purpose). */
export const paymentPurposes = ["registration_fee", "evening_booking", "contribution"] as const;
export type PaymentPurpose = (typeof paymentPurposes)[number];

/** Filtre des remboursements de app.admin_payments() : demandé (pas encore effectué) ou effectué. */
export const refundFilters = ["requested", "refunded"] as const;
export type RefundFilter = (typeof refundFilters)[number];

/** Ligne de app.admin_payments() ; « total » : nombre de lignes du filtre, toutes pages. */
export type PaymentRow = {
  payment_id: string;
  created_at: string;
  user_id: string | null;
  member_number: string | null;
  first_name: string | null;
  last_name: string | null;
  purpose: PaymentPurpose;
  amount_xof: number;
  provider: string;
  provider_transaction_id: string | null;
  status: PaymentStatus;
  refunded_amount_xof: number;
  refund_requested_at: string | null;
  reconciled_at: string | null;
  event_id: string | null;
  event_starts_at: string | null;
  total: number;
};

export type PaymentQuery = { search: string; status: PaymentStatus | null; purpose: PaymentPurpose | null; refund: RefundFilter | null; page: number };

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(list: readonly T[], v: string): T | null => (list as readonly string[]).includes(v) ? (v as T) : null;

/** Filtres reflétés dans l'adresse (11.3) : ?q=, ?etat=, ?objet=, ?remboursement=, ?page=. Valeurs inconnues ignorées. */
export function parsePaymentQuery(params: Params): PaymentQuery {
  const page = Number.parseInt(first(params.page), 10);
  return {
    search: first(params.q).trim().slice(0, 100),
    status: oneOf(paymentStatuses, first(params.etat)),
    purpose: oneOf(paymentPurposes, first(params.objet)),
    refund: oneOf(refundFilters, first(params.remboursement)),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Paramètres de app.admin_payments() pour une requête. */
export function paymentRpcArgs(query: PaymentQuery) {
  return {
    p_search: query.search || null,
    p_status: query.status,
    p_purpose: query.purpose,
    p_refund: query.refund,
    p_limit: PAGE_SIZE,
    p_offset: (query.page - 1) * PAGE_SIZE,
  };
}

/** Paramètres d'adresse d'une requête (sans les valeurs vides), pour les liens de pagination. */
export function paymentQueryParams(query: PaymentQuery, page = query.page): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.search) out.q = query.search;
  if (query.status) out.etat = query.status;
  if (query.purpose) out.objet = query.purpose;
  if (query.refund) out.remboursement = query.refund;
  if (page > 1) out.page = String(page);
  return out;
}

/** Remboursement d'une ligne : demandé (en attente du prestataire), effectué, ou aucun. */
export function refundState(row: Pick<PaymentRow, "status" | "refund_requested_at">): RefundFilter | null {
  if (row.status === "refunded") return "refunded";
  if (row.status === "succeeded" && row.refund_requested_at !== null) return "requested";
  return null;
}

/** Clé de traduction du prestataire (Admin.payments.providers), « other » s'il est inconnu. */
const providers = ["simulated", "fedapay", "kkiapay", "feexpay"] as const;
export function providerKey(provider: string): (typeof providers)[number] | "other" {
  return oneOf(providers, provider) ?? "other";
}
