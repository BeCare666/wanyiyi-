import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { locale as rootLocale } from "next/root-params";
import { routing } from "./routing";

/**
 * La langue est lue dans le paramètre racine [locale] (next/root-params, Next.js 16).
 * Toute section serveur obtient ainsi la bonne langue, sans setRequestLocale (déprécié).
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = (await rootLocale()) ?? (await requestLocale);
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    timeZone: "Africa/Porto-Novo",
    messages: (await import(`../../messages/${locale}.json`)).default,
    formats: {
      number: {
        fcfa: { style: "currency", currency: "XOF", maximumFractionDigits: 0 },
      },
      dateTime: {
        eventDay: { weekday: "long", day: "numeric", month: "long" },
        eventTime: { hour: "2-digit", minute: "2-digit" },
      },
    },
  };
});
