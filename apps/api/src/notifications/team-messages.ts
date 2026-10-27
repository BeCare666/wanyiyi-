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
  // « Bien rentré(e) ? » (question 5, 27 octobre 2026)
  checkinSubject: string;
  checkinLine: string;
  checkinReminderSubject: string;
  answer: string;
  helpSubject: string;
  noAnswerSubject: string;
  alertLine: (who: string) => string;
  alertHelp: string;
  alertNoAnswer: string;
  openIfedele: string;
};

const TEXTS: Record<Locale, Texts> = {
  fr: {
    messageSubject: "Un message de l'équipe Ifedele",
    openSpace: "Ouvrir mon espace",
    invitationSubject: "Une invitation à une soirée Ifedele",
    invitationLine: (date) => `Ifedele vous invite à la soirée du ${date}. Réservez votre place depuis votre espace, s'il en reste.`,
    book: "Voir la soirée",
    footer: "Vous recevez ce message parce que ce canal est activé dans vos paramètres Ifedele.",
    checkinSubject: "Bien rentré(e) ?",
    checkinLine: "Votre rendez-vous est passé. Êtes-vous bien rentré(e) ? Répondez « Oui » ou « J'ai besoin d'aide » depuis votre espace. L'autre personne ne voit pas votre réponse.",
    checkinReminderSubject: "Rappel : bien rentré(e) ?",
    answer: "Répondre",
    helpSubject: "Alerte : un membre demande de l'aide",
    noAnswerSubject: "Alerte : un membre n'a pas répondu après son rendez-vous",
    alertLine: (who) => `Membre : ${who}.`,
    alertHelp: "Ce membre a répondu « J'ai besoin d'aide » après son rendez-vous. Contactez-le sans attendre.",
    alertNoAnswer: "Ce membre n'a pas répondu à « Bien rentré(e) ? » 24 heures après son rendez-vous. Décidez s'il faut le contacter.",
    openIfedele: "Ouvrir Ifedele",
  },
  en: {
    messageSubject: "A message from the Ifedele team",
    openSpace: "Open my space",
    invitationSubject: "An invitation to a Ifedele evening",
    invitationLine: (date) => `Ifedele invites you to the evening of ${date}. Book your seat from your space, while seats remain.`,
    book: "See the evening",
    footer: "You receive this message because this channel is enabled in your Ifedele settings.",
    checkinSubject: "Did you get home safely?",
    checkinLine: "Your date is over. Did you get home safely? Answer “Yes” or “I need help” from your space. The other person does not see your answer.",
    checkinReminderSubject: "Reminder: did you get home safely?",
    answer: "Answer",
    helpSubject: "Alert: a member is asking for help",
    noAnswerSubject: "Alert: a member has not answered after their date",
    alertLine: (who) => `Member: ${who}.`,
    alertHelp: "This member answered “I need help” after their date. Contact them right away.",
    alertNoAnswer: "This member has not answered “Did you get home safely?” 24 hours after their date. Decide whether to contact them.",
    openIfedele: "Open Ifedele",
  },
  yo: {
    messageSubject: "Ìránṣẹ́ láti ọ̀dọ̀ ẹgbẹ́ Ifedele",
    openSpace: "Ṣí àyè mi",
    invitationSubject: "Ìpè sí ìpàdé alẹ́ Ifedele",
    invitationLine: (date) => `Ifedele pè yín sí ìpàdé alẹ́ ọjọ́ ${date}. Ẹ gba àyè yín láti inú àyè yín, bí àyè bá ṣì wà.`,
    book: "Wo ìpàdé náà",
    footer: "Ẹ ń gba ìránṣẹ́ yìí nítorí pé ọ̀nà yìí wà ní títàn nínú àwọn ètò Ifedele yín.",
    checkinSubject: "Ṣé ẹ dé ilé láìléwu?",
    checkinLine: "Ìpàdé yín ti parí. Ṣé ẹ dé ilé láìléwu? Ẹ dáhùn « Bẹ́ẹ̀ ni » tàbí « Mo nílò ìrànlọ́wọ́ » láti inú àyè yín. Ẹnì kejì kò ní rí ìdáhùn yín.",
    checkinReminderSubject: "Ìránnilétí: ṣé ẹ dé ilé láìléwu?",
    answer: "Dáhùn",
    helpSubject: "Ìkìlọ̀: ọmọ ẹgbẹ́ kan ń béèrè ìrànlọ́wọ́",
    noAnswerSubject: "Ìkìlọ̀: ọmọ ẹgbẹ́ kan kò dáhùn lẹ́yìn ìpàdé rẹ̀",
    alertLine: (who) => `Ọmọ ẹgbẹ́: ${who}.`,
    alertHelp: "Ọmọ ẹgbẹ́ yìí dáhùn « Mo nílò ìrànlọ́wọ́ » lẹ́yìn ìpàdé rẹ̀. Ẹ kàn sí i lẹ́sẹ̀kẹsẹ̀.",
    alertNoAnswer: "Ọmọ ẹgbẹ́ yìí kò dáhùn « Ṣé ẹ dé ilé láìléwu? » ní wákàtí 24 lẹ́yìn ìpàdé rẹ̀. Ẹ pinnu bóyá ẹ ó kàn sí i.",
    openIfedele: "Ṣí Ifedele",
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

  if (kind === "date.checkin" || kind === "date.checkin_reminder") {
    const subject = kind === "date.checkin" ? t.checkinSubject : t.checkinReminderSubject;
    const link = siteUrl(webOrigin, locale, "/espace");
    return {
      sms: `${subject} ${link}`,
      email: {
        subject,
        html: emailLayout({ locale, title: subject, paragraphs: [t.checkinLine], button: { label: t.answer, href: link }, footer: t.footer }),
        text: `${subject}\n\n${t.checkinLine}\n\n${link}\n\n${t.footer}`,
      },
    };
  }

  // Alertes à l'équipe et au conseiller : prénom, numéro de membre et téléphone du membre
  if (kind === "date.help_requested" || kind === "date.checkin_no_answer") {
    const who = [data.first_name, data.member_number, data.phone].filter((x): x is string => typeof x === "string" && x !== "").join(", ");
    if (who === "") return null;
    const subject = kind === "date.help_requested" ? t.helpSubject : t.noAnswerSubject;
    const body = kind === "date.help_requested" ? t.alertHelp : t.alertNoAnswer;
    const link = siteUrl(webOrigin, locale, "/connexion");
    return {
      sms: `${subject}. ${t.alertLine(who)}`,
      email: {
        subject,
        html: emailLayout({ locale, title: subject, paragraphs: [body, t.alertLine(who)], button: { label: t.openIfedele, href: link }, footer: t.footer }),
        text: `${subject}\n\n${body}\n${t.alertLine(who)}\n\n${link}\n\n${t.footer}`,
      },
    };
  }

  return null;
}
