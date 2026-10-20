import { type FilterNode, isValidFilter } from "./filters";

/**
 * Actions groupées de la liste des membres (section 11.3, décisions du 19 octobre 2026) :
 * notification écrite en trois langues, invitation à une soirée (notification avec lien).
 * Mêmes limites que app.admin_notify_members et app.admin_invite_members.
 */

/** Formulaire auquel se rattachent les cases du tableau (attribut form) : la sélection reste dans la page. */
export const BULK_FORM = "actions-groupees";
export const BULK_FIELD = "membre";

export const bulkLocales = ["fr", "en", "yo"] as const;
export type BulkMessage = Record<(typeof bulkLocales)[number], string>;

export const MESSAGE_MAX = 500;
export const MAX_SELECTED = 200;
export const MAX_FILTERED = 5000;

/** Membres visés : cochés sur la page, ou tout le résultat du filtre affiché. */
export type BulkTarget = { kind: "selected"; ids: string[] } | { kind: "filter"; filter: FilterNode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paramètres p_targets et p_filter des fonctions SQL, ou null si la cible est invalide. */
export function targetArgs(target: BulkTarget): { p_targets: string[] | null; p_filter: FilterNode | null } | null {
  if (target.kind === "selected") {
    const ids = [...new Set(target.ids)];
    if (ids.length === 0 || ids.length > MAX_SELECTED || !ids.every((id) => UUID.test(id))) return null;
    return { p_targets: ids, p_filter: null };
  }
  return isValidFilter(target.filter) ? { p_targets: null, p_filter: target.filter } : null;
}

/** Message complet dans les trois langues, 500 caractères au plus chacun. */
export function checkMessage(message: BulkMessage): "invalid_message" | null {
  return bulkLocales.every((l) => {
    const text = (message[l] ?? "").trim();
    return text.length >= 1 && text.length <= MESSAGE_MAX;
  })
    ? null
    : "invalid_message";
}

/** Tout le résultat de la liste (sans filtre) : groupe ET vide, accepté par la base. */
export const everyone: FilterNode = { op: "and", items: [] };
