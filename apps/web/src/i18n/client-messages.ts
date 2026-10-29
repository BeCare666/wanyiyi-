import type { AbstractIntlMessages } from "next-intl";

/**
 * Textes des espaces privés (membre, conseiller, administration) : près des trois quarts des
 * messages. Les pages publiques ne les envoient pas au navigateur ; chaque espace privé les
 * fournit dans sa propre mise en page (NextIntlClientProvider sans `messages` : tous les textes).
 */
export const PRIVATE_NAMESPACES = ["Admin", "Member", "Counselor"] as const;

export function publicMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return Object.fromEntries(
    Object.entries(messages).filter(([key]) => !(PRIVATE_NAMESPACES as readonly string[]).includes(key)),
  );
}
