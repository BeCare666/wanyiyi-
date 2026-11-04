import { emailLayout, type Locale } from "./messages";

/**
 * E-mails des étapes du parcours (audit UX du 3 novembre 2026) : une notification à chaque action
 * du membre, de l'inscription à la place confirmée. Vouvoiement, aucun tiret long. Le yoruba est
 * un brouillon à faire valider (TRADUCTIONS.md).
 */

type Step = { subject: string; line: (date: string | null) => string; button: string; path: string };

export const JOURNEY_KINDS = [
  "registration.completed",
  "verification.submitted",
  "profile.photo_approved",
  "evening.booked",
  "evening.confirmed",
  "evening.waitlisted",
  "evening.registration_cancelled",
  "evening.seat_released",
] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];

const on = (date: string | null, fr: string) => (date ? fr.replace("{date}", date) : fr.replace(" du {date}", "").replace(" {date}", ""));

const TEXTS: Record<Locale, Record<JourneyKind, Step>> = {
  fr: {
    "registration.completed": {
      subject: "Bienvenue chez Ifedele",
      line: () => "Votre inscription est enregistrée. Étape suivante : votre vérification. Signez la déclaration sur l'honneur, prenez votre selfie en direct et ajoutez une photo de profil : l'équipe examine le tout en une fois.",
      button: "Compléter ma vérification",
      path: "/espace/verification",
    },
    "verification.submitted": {
      subject: "Votre dossier Ifedele est envoyé",
      line: () => "Votre dossier est entre les mains de l'équipe. Vous recevrez un e-mail dès sa décision. En attendant, complétez votre profil : c'est par lui que les autres membres vous découvrent.",
      button: "Compléter mon profil",
      path: "/espace/profil",
    },
    "profile.photo_approved": {
      subject: "Votre photo de profil est approuvée",
      line: () => "L'équipe a approuvé votre photo de profil. Vous pouvez réserver une soirée depuis votre espace.",
      button: "Voir les soirées",
      path: "/espace/soirees",
    },
    "evening.booked": {
      subject: "Votre place est réservée",
      line: (d) => on(d, "Votre place pour la soirée du {date} est réservée. Payez-la depuis Mes soirées : le paiement la confirme. Sans paiement avant la date limite, elle est libérée."),
      button: "Payer ma place",
      path: "/espace/soirees?filtre=mine",
    },
    "evening.confirmed": {
      subject: "Votre place est confirmée",
      line: (d) => on(d, "Votre place pour la soirée du {date} est confirmée. Notre équipe vous accueillera à l'entrée. À bientôt."),
      button: "Voir mes soirées",
      path: "/espace/soirees?filtre=mine",
    },
    "evening.waitlisted": {
      subject: "Vous êtes sur liste d'attente",
      line: (d) => on(d, "La soirée du {date} est complète pour le moment : vous êtes sur liste d'attente. Vous serez prévenu(e) si une place se libère."),
      button: "Voir mes soirées",
      path: "/espace/soirees?filtre=mine",
    },
    "evening.registration_cancelled": {
      subject: "Votre place est annulée",
      line: (d) => on(d, "Votre place pour la soirée du {date} est annulée. Vous pouvez réserver une autre soirée quand vous le souhaitez."),
      button: "Voir les soirées",
      path: "/espace/soirees",
    },
    "evening.seat_released": {
      subject: "Votre place a été libérée",
      line: (d) => on(d, "Votre place pour la soirée du {date} a été libérée, faute de paiement ou de confirmation à temps. Vous pouvez réserver une autre soirée."),
      button: "Voir les soirées",
      path: "/espace/soirees",
    },
  },
  en: {
    "registration.completed": {
      subject: "Welcome to Ifedele",
      line: () => "Your registration is recorded. Next step: your verification. Sign the sworn statement, take your live selfie and add a profile photo: the team reviews everything at once.",
      button: "Complete my verification",
      path: "/espace/verification",
    },
    "verification.submitted": {
      subject: "Your Ifedele file has been sent",
      line: () => "Your file is with the team. You will receive an e-mail as soon as it is decided. Meanwhile, complete your profile: it is how other members get to know you.",
      button: "Complete my profile",
      path: "/espace/profil",
    },
    "profile.photo_approved": {
      subject: "Your profile photo is approved",
      line: () => "The team has approved your profile photo. You can book an evening from your space.",
      button: "See the evenings",
      path: "/espace/soirees",
    },
    "evening.booked": {
      subject: "Your seat is booked",
      line: (d) => (d ? `Your seat for the evening of ${d} is booked.` : "Your seat is booked.") + " Pay for it from My evenings: payment confirms it. If it is not paid before the deadline, it is released.",
      button: "Pay for my seat",
      path: "/espace/soirees?filtre=mine",
    },
    "evening.confirmed": {
      subject: "Your seat is confirmed",
      line: (d) => (d ? `Your seat for the evening of ${d} is confirmed.` : "Your seat is confirmed.") + " Our team will welcome you at the door. See you soon.",
      button: "See my evenings",
      path: "/espace/soirees?filtre=mine",
    },
    "evening.waitlisted": {
      subject: "You are on the waiting list",
      line: (d) => (d ? `The evening of ${d} is full for now:` : "The evening is full for now:") + " you are on the waiting list. You will be told if a seat becomes free.",
      button: "See my evenings",
      path: "/espace/soirees?filtre=mine",
    },
    "evening.registration_cancelled": {
      subject: "Your seat is cancelled",
      line: (d) => (d ? `Your seat for the evening of ${d} is cancelled.` : "Your seat is cancelled.") + " You can book another evening whenever you wish.",
      button: "See the evenings",
      path: "/espace/soirees",
    },
    "evening.seat_released": {
      subject: "Your seat was released",
      line: (d) => (d ? `Your seat for the evening of ${d} was released` : "Your seat was released") + " because it was not paid or confirmed in time. You can book another evening.",
      button: "See the evenings",
      path: "/espace/soirees",
    },
  },
  yo: {
    "registration.completed": {
      subject: "Ẹ káàbọ̀ sí Ifedele",
      line: () => "A ti kọ ìforúkọsílẹ̀ yín sílẹ̀. Ìgbésẹ̀ tó kàn: àyẹ̀wò yín. Ẹ buwọ́ lu ìbúra, ẹ ya fọ́tò ojú yín lójú ẹsẹ̀, kí ẹ sì fi fọ́tò àkọsílẹ̀ kún un: ẹgbẹ́ yóò ṣàyẹ̀wò gbogbo rẹ̀ lẹ́ẹ̀kan náà.",
      button: "Parí àyẹ̀wò mi",
      path: "/espace/verification",
    },
    "verification.submitted": {
      subject: "A ti fi ìwé Ifedele yín ránṣẹ́",
      line: () => "Ìwé yín ti wà lọ́wọ́ ẹgbẹ́. Ẹ ó gba e-mail ní kété tí wọ́n bá ṣe ìpinnu. Ní àsìkò yìí, ẹ parí àkọsílẹ̀ yín: òun ni àwọn ọmọ ẹgbẹ́ mìíràn fi ń mọ̀ yín.",
      button: "Parí àkọsílẹ̀ mi",
      path: "/espace/profil",
    },
    "profile.photo_approved": {
      subject: "A ti fọwọ́ sí fọ́tò àkọsílẹ̀ yín",
      line: () => "Ẹgbẹ́ ti fọwọ́ sí fọ́tò àkọsílẹ̀ yín. Ẹ lè gba àyè ní ìpàdé alẹ́ láti inú ààyè yín.",
      button: "Wo àwọn ìpàdé alẹ́",
      path: "/espace/soirees",
    },
    "evening.booked": {
      subject: "A ti gba àyè yín sílẹ̀",
      line: (d) => (d ? `A ti gba àyè yín sílẹ̀ fún ìpàdé alẹ́ ${d}.` : "A ti gba àyè yín sílẹ̀.") + " Ẹ san owó rẹ̀ nínú Àwọn ìpàdé mi: ìsanwó ni yóò fìdí rẹ̀ múlẹ̀. Bí ẹ kò bá sanwó ṣáájú ọjọ́ ìparí, a ó fi í sílẹ̀.",
      button: "San owó àyè mi",
      path: "/espace/soirees?filtre=mine",
    },
    "evening.confirmed": {
      subject: "A ti fìdí àyè yín múlẹ̀",
      line: (d) => (d ? `A ti fìdí àyè yín múlẹ̀ fún ìpàdé alẹ́ ${d}.` : "A ti fìdí àyè yín múlẹ̀.") + " Ẹgbẹ́ wa yóò kí yín káàbọ̀ ní ẹnu ọ̀nà. A ó rí yín láìpẹ́.",
      button: "Wo àwọn ìpàdé mi",
      path: "/espace/soirees?filtre=mine",
    },
    "evening.waitlisted": {
      subject: "Ẹ wà nínú àkójọ ìdúró",
      line: (d) => (d ? `Ìpàdé alẹ́ ${d} ti kún fún báyìí:` : "Ìpàdé alẹ́ ti kún fún báyìí:") + " ẹ wà nínú àkójọ ìdúró. A ó sọ fún yín bí àyè kan bá ṣí sílẹ̀.",
      button: "Wo àwọn ìpàdé mi",
      path: "/espace/soirees?filtre=mine",
    },
    "evening.registration_cancelled": {
      subject: "A ti fagi lé àyè yín",
      line: (d) => (d ? `A ti fagi lé àyè yín fún ìpàdé alẹ́ ${d}.` : "A ti fagi lé àyè yín.") + " Ẹ lè gba àyè ní ìpàdé alẹ́ mìíràn nígbàkúùgbà.",
      button: "Wo àwọn ìpàdé alẹ́",
      path: "/espace/soirees",
    },
    "evening.seat_released": {
      subject: "A ti fi àyè yín sílẹ̀",
      line: (d) => (d ? `A ti fi àyè yín sílẹ̀ fún ìpàdé alẹ́ ${d}` : "A ti fi àyè yín sílẹ̀") + " nítorí pé a kò san owó rẹ̀ tàbí fìdí rẹ̀ múlẹ̀ ní àkókò. Ẹ lè gba àyè ní ìpàdé alẹ́ mìíràn.",
      button: "Wo àwọn ìpàdé alẹ́",
      path: "/espace/soirees",
    },
  },
};

export function isJourneyKind(kind: string): kind is JourneyKind {
  return (JOURNEY_KINDS as readonly string[]).includes(kind);
}

/**
 * Contenu d'une étape. `date` : date de la soirée déjà mise en forme (null si absente).
 * Une soirée gratuite (priced = false) n'a rien à payer : le message de réservation dit de la confirmer.
 */
export function journeyContent(
  kind: JourneyKind,
  locale: Locale,
  date: string | null,
  priced: boolean,
  link: (path: string) => string,
  footer: string,
) {
  const step = TEXTS[locale][kind];
  const free = kind === "evening.booked" && !priced;
  const freeLine: Record<Locale, string> = {
    fr: "Cette soirée est gratuite : confirmez votre place depuis Mes soirées avant la date limite.",
    en: "This evening is free: confirm your seat from My evenings before the deadline.",
    yo: "Ìpàdé alẹ́ yìí jẹ́ ọ̀fẹ́: ẹ fìdí àyè yín múlẹ̀ nínú Àwọn ìpàdé mi ṣáájú ọjọ́ ìparí.",
  };
  const confirmLabel: Record<Locale, string> = { fr: "Confirmer ma place", en: "Confirm my seat", yo: "Fìdí àyè mi múlẹ̀" };
  const firstSentence = step.line(date).split(/(?<=\.)\s/)[0]!;
  const line = free ? `${firstSentence} ${freeLine[locale]}` : step.line(date);
  const button = free ? confirmLabel[locale] : step.button;
  const href = link(step.path);
  return {
    sms: `${step.subject}. ${href}`,
    email: {
      subject: step.subject,
      html: emailLayout({ locale, title: step.subject, paragraphs: [line], button: { label: button, href }, footer }),
      text: `${step.subject}\n\n${line}\n\n${href}\n\n${footer}`,
    },
  };
}
