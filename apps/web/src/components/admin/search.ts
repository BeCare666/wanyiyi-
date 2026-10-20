/** Types de résultat de app.admin_search(), dans l'ordre d'affichage. */
export const searchKinds = ["member", "verification", "evening", "venue", "payment"] as const;
export type SearchKind = (typeof searchKinds)[number];

/** Ligne de app.admin_search() : titre et détail bruts, mis en forme par le site. */
export type SearchHit = { kind: SearchKind; id: string; title: string | null; detail: string | null; at: string | null };

/** Recherche lancée à partir de 2 caractères (même règle que la base). */
export const SEARCH_MIN_LENGTH = 2;

/** Page ouverte par un résultat. Les lieux n'ont pas de fiche : la liste suffit. */
export function searchHref(hit: Pick<SearchHit, "kind" | "id" | "title">): string | { pathname: string; query: Record<string, string> } {
  switch (hit.kind) {
    case "member":
      return `/admin/membres/${hit.id}`;
    case "verification":
      return `/admin/verifications/${hit.id}`;
    case "evening":
      return `/admin/soirees/${hit.id}`;
    case "venue":
      return "/admin/lieux";
    case "payment":
      return hit.title ? { pathname: "/admin/paiements", query: { q: hit.title } } : "/admin/paiements";
  }
}

/** Résultats regroupés par type, dans l'ordre de searchKinds ; types inconnus ignorés. */
export function groupHits(hits: readonly SearchHit[]): Array<{ kind: SearchKind; hits: SearchHit[] }> {
  return searchKinds.map((kind) => ({ kind, hits: hits.filter((h) => h.kind === kind) })).filter((g) => g.hits.length > 0);
}

/**
 * Raccourci d'ouverture : Ctrl+K (Cmd+K sur Mac) partout, ou « / » hors d'un champ de saisie.
 */
export function isSearchShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, typing: boolean): boolean {
  if (event.altKey) return false;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") return true;
  return event.key === "/" && !event.ctrlKey && !event.metaKey && !typing;
}

const statusKeys: Partial<Record<SearchKind, { prefix: string; values: readonly string[] }>> = {
  verification: { prefix: "verifications.status", values: ["pending", "to_correct", "approved", "rejected"] },
  evening: { prefix: "evenings.status", values: ["draft", "published", "full", "in_progress", "finished", "cancelled"] },
  payment: { prefix: "payments.status", values: ["pending", "succeeded", "failed", "refunded", "cancelled"] },
};

/** Clé de traduction (espace Admin) de l'état d'un résultat, ou null : le détail s'affiche tel quel. */
export function hitStatusKey(hit: Pick<SearchHit, "kind" | "detail">): string | null {
  const keys = statusKeys[hit.kind];
  return keys && hit.detail && keys.values.includes(hit.detail) ? `${keys.prefix}.${hit.detail}` : null;
}
