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
  // Décision sur le dossier de vérification et photo refusée (30 octobre 2026)
  approvedSubject: string;
  approvedLines: string[];
  seeEvenings: string;
  correctionSubject: string;
  correctionLine: string;
  teamNote: (note: string) => string;
  correct: string;
  rejectedSubject: string;
  rejectedLine: string;
  reasonLine: (reason: string) => string;
  contact: string;
  photoRejectedSubject: string;
  photoRejectedLine: string;
  openProfile: string;
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
    approvedSubject: "Votre compte Ifedele est validé",
    approvedLines: [
      "L'équipe Ifedele a examiné votre dossier et validé votre compte.",
      "Prochaine étape : réservez votre place à une soirée depuis votre espace. Une photo de profil approuvée est demandée pour réserver ; si vous n'en avez pas encore, ajoutez-en une dans votre profil.",
    ],
    seeEvenings: "Voir les soirées",
    correctionSubject: "Votre dossier Ifedele est à corriger",
    correctionLine: "L'équipe Ifedele a examiné votre dossier et vous demande une correction avant de valider votre compte.",
    teamNote: (note) => `Message de l'équipe : ${note}`,
    correct: "Corriger mon dossier",
    rejectedSubject: "Votre dossier Ifedele n'a pas été accepté",
    rejectedLine: "L'équipe Ifedele a examiné votre dossier et ne peut pas valider votre compte.",
    reasonLine: (reason) => `Motif : ${reason}`,
    contact: "Nous contacter",
    photoRejectedSubject: "Une photo de votre profil a été refusée",
    photoRejectedLine: "Une photo de votre profil a été refusée. Déposez-en une autre depuis votre profil : elle sera relue de nouveau.",
    openProfile: "Ouvrir mon profil",
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
    approvedSubject: "Your Ifedele account is approved",
    approvedLines: [
      "The Ifedele team has reviewed your file and approved your account.",
      "Next step: book your seat at an evening from your space. An approved profile photo is required to book; if you do not have one yet, add one in your profile.",
    ],
    seeEvenings: "See the evenings",
    correctionSubject: "Your Ifedele file needs a correction",
    correctionLine: "The Ifedele team has reviewed your file and asks you for a correction before approving your account.",
    teamNote: (note) => `Message from the team: ${note}`,
    correct: "Correct my file",
    rejectedSubject: "Your Ifedele file was not accepted",
    rejectedLine: "The Ifedele team has reviewed your file and cannot approve your account.",
    reasonLine: (reason) => `Reason: ${reason}`,
    contact: "Contact us",
    photoRejectedSubject: "A photo of your profile was declined",
    photoRejectedLine: "A photo of your profile was declined. Upload another one from your profile: it will be reviewed again.",
    openProfile: "Open my profile",
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
    approvedSubject: "A ti fọwọ́ sí àkọọ́lẹ̀ Ifedele yín",
    approvedLines: [
      "Ẹgbẹ́ Ifedele ti yẹ ìwé yín wò, wọ́n sì ti fọwọ́ sí àkọọ́lẹ̀ yín.",
      "Ìgbésẹ̀ tó kàn: ẹ gba àyè yín ní ìpàdé alẹ́ kan láti inú àyè yín. Àwòrán tí a ti fọwọ́ sí ni a nílò láti gba àyè; bí ẹ kò bá tíì ní, ẹ fi ọ̀kan kún un nínú àpèjúwe yín.",
    ],
    seeEvenings: "Wo àwọn ìpàdé alẹ́",
    correctionSubject: "Ẹ nílò láti ṣàtúnṣe ìwé Ifedele yín",
    correctionLine: "Ẹgbẹ́ Ifedele ti yẹ ìwé yín wò, wọ́n sì ń béèrè àtúnṣe kí wọ́n tó fọwọ́ sí àkọọ́lẹ̀ yín.",
    teamNote: (note) => `Ìránṣẹ́ ẹgbẹ́: ${note}`,
    correct: "Ṣàtúnṣe ìwé mi",
    rejectedSubject: "A kò gba ìwé Ifedele yín",
    rejectedLine: "Ẹgbẹ́ Ifedele ti yẹ ìwé yín wò, wọn kò sì lè fọwọ́ sí àkọọ́lẹ̀ yín.",
    reasonLine: (reason) => `Ìdí: ${reason}`,
    contact: "Kàn sí wa",
    photoRejectedSubject: "A kọ àwòrán kan nínú àpèjúwe yín",
    photoRejectedLine: "A kọ àwòrán kan nínú àpèjúwe yín. Ẹ fi òmíràn ránṣẹ́ láti inú àpèjúwe yín: a ó tún un yẹ̀ wò.",
    openProfile: "Ṣí àpèjúwe mi",
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

  // Décision de l'équipe sur le dossier, et photo refusée (30 octobre 2026) : motif joint s'il existe
  const decisions: Record<string, { subject: string; lines: string[]; button: string; path: string; note?: (n: string) => string }> = {
    "verification.approved": { subject: t.approvedSubject, lines: t.approvedLines, button: t.seeEvenings, path: "/espace/soirees" },
    "verification.to_correct": { subject: t.correctionSubject, lines: [t.correctionLine], button: t.correct, path: "/espace/verification", note: t.teamNote },
    "verification.rejected": { subject: t.rejectedSubject, lines: [t.rejectedLine], button: t.contact, path: "/contact", note: t.reasonLine },
    "profile.photo_rejected": { subject: t.photoRejectedSubject, lines: [t.photoRejectedLine], button: t.openProfile, path: "/espace/profil", note: t.reasonLine },
  };
  const decision = Object.hasOwn(decisions, kind) ? decisions[kind]! : null;
  if (decision) {
    const reason = typeof data.reason === "string" && data.reason.trim() !== "" ? data.reason.trim() : null;
    const paragraphs = reason && decision.note ? [...decision.lines, decision.note(reason)] : decision.lines;
    const link = siteUrl(webOrigin, locale, decision.path);
    return {
      sms: `${decision.subject}. ${link}`,
      email: {
        subject: decision.subject,
        html: emailLayout({ locale, title: decision.subject, paragraphs, button: { label: decision.button, href: link }, footer: t.footer }),
        text: `${decision.subject}\n\n${paragraphs.join("\n\n")}\n\n${link}\n\n${t.footer}`,
      },
    };
  }

  return null;
}
