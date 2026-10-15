import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "en", "yo"],
  defaultLocale: "fr",
  // Le français, langue source, reste sans préfixe : /, /en, /yo
  localePrefix: "as-needed",
  localeCookie: { name: "WANYIYI_LOCALE", maxAge: 60 * 60 * 24 * 365 },
});

export type Locale = (typeof routing.locales)[number];
