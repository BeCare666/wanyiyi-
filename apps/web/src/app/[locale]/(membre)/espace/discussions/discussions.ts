/**
 * Menu « Discussions » (demande du 13/11/2026) : une ligne par discussion, lue par
 * app.my_conversations avec le jeton du membre. Logique pure, testée (tests/discussions.test.ts).
 */
export type ConversationKind = "discovery" | "discovery_ended" | "couple" | "counsel";

export type ConversationRow = {
  kind: ConversationKind;
  conversation_id: string;
  target_id: string | null;
  title: string | null;
  last_body: string | null;
  last_is_system: boolean | null;
  last_from_me: boolean | null;
  last_at: string | null;
  unread: number;
  read_only: boolean;
  ends_at: string | null;
  delete_after: string | null;
};

/** Page à ouvrir, et l'onglet Discussion quand la page en a plusieurs (paramètre TAB_PARAM ajouté par la page). */
export type ConversationHref = { pathname: string; tab?: "discussion" };

/** Page où s'ouvre la discussion : celle qui existe déjà pour chaque espace. */
export function conversationHref(row: ConversationRow): ConversationHref {
  switch (row.kind) {
    case "discovery":
    case "discovery_ended":
      return { pathname: `/espace/matchs/${row.target_id}`, tab: "discussion" };
    case "couple":
      return { pathname: "/espace/couple", tab: "discussion" };
    case "counsel":
      return { pathname: "/espace/conseiller" };
  }
}

/** En cours d'abord (la plus récente en haut), puis les terminées (lecture seule). */
export function splitConversations(rows: readonly ConversationRow[]): { current: ConversationRow[]; ended: ConversationRow[] } {
  const recent = (a: ConversationRow, b: ConversationRow) => (b.last_at ?? "").localeCompare(a.last_at ?? "");
  return {
    current: rows.filter((r) => r.kind !== "discovery_ended").sort(recent),
    ended: rows.filter((r) => r.kind === "discovery_ended").sort(recent),
  };
}

/** Initiale de l'avatar (prénom de l'autre ou nom du conseiller). */
export function initial(title: string | null): string {
  return (title ?? "").trim().slice(0, 1).toUpperCase() || "·";
}
