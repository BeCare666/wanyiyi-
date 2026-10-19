import { memberNav } from "./memberNav";

/** Types de notification connus, avec la page où ils mènent (les autres : texte générique). */
const kinds = {
  evening_seat_offered: { href: { pathname: memberNav.evenings.href, query: { filtre: "mine" } } },
  match_announced: { href: { pathname: memberNav.matches.href } },
  // Soirée publiée modifiée ou annulée (19 octobre 2026)
  evening_updated: { href: { pathname: memberNav.evenings.href, query: { filtre: "mine" } } },
  evening_cancelled: { href: { pathname: memberNav.evenings.href, query: { filtre: "mine" } } },
  // Décisions de l'équipe (19 octobre 2026) : le motif est affiché avec la notification
  member_suspended: { href: null },
  member_reactivated: { href: null },
  member_excluded: { href: null },
} as const;

export type NotificationKey = keyof typeof kinds | "other";

/** Clé de traduction (Member.bell.kinds) : les points du type deviennent des tirets bas. */
export function notificationKey(kind: string): NotificationKey {
  const key = kind.replace(/\./g, "_");
  return Object.hasOwn(kinds, key) ? (key as keyof typeof kinds) : "other";
}

/** Page à ouvrir depuis la notification, ou null si elle n'en a pas. */
export function notificationHref(kind: string) {
  const key = notificationKey(kind);
  return key === "other" ? null : kinds[key].href;
}
