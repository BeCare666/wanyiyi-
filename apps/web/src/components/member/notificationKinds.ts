import { memberNav } from "./memberNav";

/** Types de notification connus, avec la page où ils mènent (les autres : texte générique). */
const kinds = {
  evening_seat_offered: { href: { pathname: memberNav.evenings.href, query: { filtre: "mine" } } },
  match_announced: { href: { pathname: memberNav.matches.href } },
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
