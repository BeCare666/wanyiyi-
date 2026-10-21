import { emailLayout, type Locale, toLocale } from "./messages";

/**
 * Textes des envois SMS et e-mail des actions groupées (décisions du 19 octobre 2026) :
 * message de l'équipe (écrit par elle en trois langues) et invitation à une soirée.
 * Vouvoiement, aucun tiret long. Le yoruba est un brouillon à faire valider (TRADUCTIONS.md).
 */

export type DeliveryContent = { sms: string; email: { subject: string; html: string; text: string } };

type Texts = {
  messageSubject: string;
  openSpace: string;
  invitationSubject: string;
  invitationLine: (date: string) => string;
  book: string;
  footer: string;
};

const TEXTS: Record<Locale, Texts> = {
  fr: {
    messageSubject: "Un message de l'équipe Ifedele",
    openSpace: "Ouvrir mon espace",
    invitationSubject: "Une invitation à une soirée Ifedele",
    invitationLine: (date) => `Ifedele vous invite à la soirée du ${date}. Réservez votre place depuis votre espace, s'il en reste.`,
    book: "Voir la soirée",
    footer: "Vous recevez ce message parce que ce canal est activé dans vos paramètres Ifedele.",
  },
  en: {
    messageSubject: "A message from the Ifedele team",
    openSpace: "Open my space",
    invitationSubject: "An invitation to a Ifedele evening",
    invitationLine: (date) => `Ifedele invites you to the evening of ${date}. Book your seat from your space, while seats remain.`,
    book: "See the evening",
    footer: "You receive this message because this channel is enabled in your Ifedele settings.",
  },
  yo: {
    messageSubject: "Ìránṣẹ́ láti ọ̀dọ̀ ẹgbẹ́ Ifedele",
    openSpace: "Ṣí àyè mi",
    invitationSubject: "Ìpè sí ìpàdé alẹ́ Ifedele",
    invitationLine: (date) => `Ifedele pè yín sí ìpàdé alẹ́ ọjọ́ ${date}. Ẹ gba àyè yín láti inú àyè yín, bí àyè bá ṣì wà.`,
    book: "Wo ìpàdé náà",
    footer: "Ẹ ń gba ìránṣẹ́ yìí nítorí pé ọ̀nà yìí wà ní títàn nínú àwọn ètò Ifedele yín.",
  },
};

/** Adresse d'une page du site dans la langue du membre (français sans préfixe). */
export function siteUrl(webOrigin: string, locale: Locale, path: string): string {
  return `${webOrigin.replace(/\/+$/, "")}${locale === "fr" ? "" : `/${locale}`}${path}`;
}

/** Date et heure d'une soirée, à l'heure de Cotonou, dans la langue du membre. */
export function eveningDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Africa/Porto-Novo",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * Contenu d'un envoi pour une notification, dans la langue du membre ; null pour un type
 * que la file ne sait pas écrire (il est alors marqué en échec, sans envoi).
 */
export function deliveryContent(kind: string, payload: unknown, localeValue: unknown, webOrigin: string): DeliveryContent | null {
  const locale = toLocale(localeValue);
  const t = TEXTS[locale];
  const data = (payload ?? {}) as Record<string, unknown>;

  if (kind === "team.message") {
    const bodies = (data.body ?? {}) as Record<string, unknown>;
    const body = typeof bodies[locale] === "string" ? (bodies[locale] as string) : typeof bodies.fr === "string" ? (bodies.fr as string) : null;
    if (!body) return null;
    const link = siteUrl(webOrigin, locale, "/espace/notifications");
    return {
      sms: `Ifedele : ${body}`,
      email: {
        subject: t.messageSubject,
        html: emailLayout({ locale, title: t.messageSubject, paragraphs: [body], button: { label: t.openSpace, href: link }, footer: t.footer }),
        text: `${t.messageSubject}\n\n${body}\n\n${link}\n\n${t.footer}`,
      },
    };
  }

  if (kind === "evening.invitation") {
    if (typeof data.starts_at !== "string" || Number.isNaN(Date.parse(data.starts_at))) return null;
    const line = t.invitationLine(eveningDate(data.starts_at, locale));
    const link = siteUrl(webOrigin, locale, "/espace/soirees");
    return {
      sms: `${line} ${link}`,
      email: {
        subject: t.invitationSubject,
        html: emailLayout({ locale, title: t.invitationSubject, paragraphs: [line], button: { label: t.book, href: link }, footer: t.footer }),
        text: `${t.invitationSubject}\n\n${line}\n\n${link}\n\n${t.footer}`,
      },
    };
  }

  return null;
}
