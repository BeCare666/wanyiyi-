/**
 * Cagnottes côté équipe (11.2-10 ; phase 4, question 3). Logique pure : lignes de la liste,
 * export, contrôle du reversement saisi (mêmes règles que app.admin_mark_payout_paid).
 */

export type CagnotteListRow = {
  id: string;
  title: string;
  status: "proposed" | "open" | "closed" | "paid_out" | "refused" | "cancelled";
  goal_xof: number | null;
  closes_at: string;
  created_at: string;
  closed_reason: string | null;
  collected_xof: number;
  payout_pending: boolean;
  to_refund: boolean;
  a_first_name: string | null;
  a_number: string | null;
  b_first_name: string | null;
  b_number: string | null;
  total: number;
};

export const cagnotteExportColumns = ["title", "member_a", "member_b", "status", "collected", "goal", "closes_at", "payout_pending", "to_refund", "created_at"] as const;
export type CagnotteExportColumn = (typeof cagnotteExportColumns)[number];

export function cagnotteExportCell(
  row: CagnotteListRow,
  column: CagnotteExportColumn,
  labels: { yesNo: (b: boolean) => string; date: (iso: string) => string; status: (s: string) => string },
): string | number | null {
  switch (column) {
    case "title":
      return row.title;
    case "member_a":
      return [row.a_first_name, row.a_number].filter(Boolean).join(" · ");
    case "member_b":
      return [row.b_first_name, row.b_number].filter(Boolean).join(" · ");
    case "status":
      return labels.status(row.status);
    case "collected":
      return row.collected_xof;
    case "goal":
      return row.goal_xof;
    case "closes_at":
      return labels.date(row.closes_at);
    case "payout_pending":
      return labels.yesNo(row.payout_pending);
    case "to_refund":
      return labels.yesNo(row.to_refund);
    case "created_at":
      return labels.date(row.created_at);
  }
}

/** Reversement saisi : montant envoyé entier, positif, au plus le brut moins la commission ; référence obligatoire. */
export function checkPayout(input: { sent: string; reference: string }, maxXof: number): "invalid_amount" | "reference_required" | null {
  const sent = Number(input.sent.replace(/\s/g, ""));
  if (!Number.isInteger(sent) || sent <= 0 || sent > maxXof) return "invalid_amount";
  const reference = input.reference.trim();
  if (reference === "" || reference.length > 100) return "reference_required";
  return null;
}

/** Réglages : minimum de 100 à 10 000 000 FCFA, commission de 0 à 50 % avec 2 décimales au plus. */
export function checkSettings(input: { min: string; commission: string }): "invalid_amount" | "invalid_commission" | null {
  const min = Number(input.min.replace(/\s/g, ""));
  if (!Number.isInteger(min) || min < 100 || min > 10_000_000) return "invalid_amount";
  const commission = Number(input.commission.replace(",", "."));
  if (!Number.isFinite(commission) || commission < 0 || commission > 50 || Math.round(commission * 100) !== commission * 100) return "invalid_commission";
  return null;
}

export type AdminContribution = {
  payment_id: string;
  name: string | null;
  anonymous: boolean;
  amount_xof: number;
  status: "succeeded" | "refunded";
  refund_requested: boolean;
  paid_out: boolean;
  created_at: string;
};

export type AdminPayout = {
  id: string;
  status: "requested" | "paid" | "cancelled";
  requested_at: string;
  gross_xof: number;
  commission_xof: number;
  payout_phone: string;
  sent_xof: number | null;
  reference: string | null;
  paid_at: string | null;
};
