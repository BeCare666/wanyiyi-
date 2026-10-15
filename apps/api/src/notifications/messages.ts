/**
 * Textes des codes et e-mails d'authentification, en français, anglais et yoruba.
 * Vouvoiement, aucun tiret long. Le yoruba est un brouillon à faire valider (TRADUCTIONS.md).
 */

export type Locale = "fr" | "en" | "yo";

export function toLocale(value: unknown): Locale {
  return value === "en" || value === "yo" ? value : "fr";
}

export function otpSms(locale: Locale, code: string): string {
  switch (locale) {
    case "en":
      return `Your Wanyiyi code: ${code}. Never share it with anyone, not even our team.`;
    case "yo":
      return `Kóòdù Wanyiyi yín: ${code}. Ẹ má ṣe fi hàn ẹnikẹ́ni, kódà ẹgbẹ́ wa.`;
    default:
      return `Votre code Wanyiyi : ${code}. Ne le communiquez à personne, pas même à notre équipe.`;
  }
}

/** Types d'e-mails d'authentification pris en charge (Send Email Hook de Supabase). */
export const SUPPORTED_EMAIL_ACTIONS = ["signup", "email_change", "email", "reauthentication"] as const;
export type EmailAction = (typeof SUPPORTED_EMAIL_ACTIONS)[number];

type EmailText = { subject: string; intro: string; button: string; codeLine: string; ignore: string };

const EMAIL_TEXTS: Record<Locale, Record<EmailAction, EmailText>> = {
  fr: {
    signup: {
      subject: "Confirmez votre adresse e-mail",
      intro: "Merci de votre inscription chez Wanyiyi. Pour confirmer votre adresse e-mail, utilisez le bouton ci-dessous.",
      button: "Confirmer mon adresse",
      codeLine: "Ou saisissez ce code dans l'application :",
      ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    },
    email_change: {
      subject: "Confirmez votre nouvelle adresse e-mail",
      intro: "Vous avez demandé à changer l'adresse e-mail de votre compte Wanyiyi. Confirmez-la avec le bouton ci-dessous.",
      button: "Confirmer la nouvelle adresse",
      codeLine: "Ou saisissez ce code dans l'application :",
      ignore: "Si vous n'êtes pas à l'origine de cette demande, contactez notre équipe.",
    },
    email: {
      subject: "Votre code de connexion",
      intro: "Voici votre code de connexion à Wanyiyi.",
      button: "Me connecter",
      codeLine: "Votre code :",
      ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    },
    reauthentication: {
      subject: "Confirmez qu'il s'agit bien de vous",
      intro: "Pour confirmer cette action sur votre compte Wanyiyi, saisissez le code ci-dessous.",
      button: "Ouvrir Wanyiyi",
      codeLine: "Votre code :",
      ignore: "Si vous n'êtes pas à l'origine de cette demande, contactez notre équipe.",
    },
  },
  en: {
    signup: {
      subject: "Confirm your email address",
      intro: "Thank you for joining Wanyiyi. To confirm your email address, please use the button below.",
      button: "Confirm my address",
      codeLine: "Or enter this code in the app:",
      ignore: "If you did not make this request, you can ignore this message.",
    },
    email_change: {
      subject: "Confirm your new email address",
      intro: "You asked to change the email address of your Wanyiyi account. Please confirm it with the button below.",
      button: "Confirm the new address",
      codeLine: "Or enter this code in the app:",
      ignore: "If you did not make this request, please contact our team.",
    },
    email: {
      subject: "Your sign-in code",
      intro: "Here is your Wanyiyi sign-in code.",
      button: "Sign in",
      codeLine: "Your code:",
      ignore: "If you did not make this request, you can ignore this message.",
    },
    reauthentication: {
      subject: "Confirm it is really you",
      intro: "To confirm this action on your Wanyiyi account, please enter the code below.",
      button: "Open Wanyiyi",
      codeLine: "Your code:",
      ignore: "If you did not make this request, please contact our team.",
    },
  },
  yo: {
    signup: {
      subject: "Ẹ jẹ́rìí sí àdírẹ́sì ímeèlì yín",
      intro: "A dúpẹ́ pé ẹ forúkọ sílẹ̀ ní Wanyiyi. Láti jẹ́rìí sí àdírẹ́sì ímeèlì yín, ẹ tẹ bọ́tìnnì ìsàlẹ̀ yìí.",
      button: "Jẹ́rìí sí àdírẹ́sì mi",
      codeLine: "Tàbí kí ẹ tẹ kóòdù yìí sínú áàpù náà:",
      ignore: "Bí kì í bá ṣe ẹ̀yin ni ẹ béèrè, ẹ fojú fo ìfiránṣẹ́ yìí.",
    },
    email_change: {
      subject: "Ẹ jẹ́rìí sí àdírẹ́sì ímeèlì tuntun yín",
      intro: "Ẹ béèrè láti yí àdírẹ́sì ímeèlì àkáǹtì Wanyiyi yín padà. Ẹ jẹ́rìí sí i pẹ̀lú bọ́tìnnì ìsàlẹ̀ yìí.",
      button: "Jẹ́rìí sí àdírẹ́sì tuntun",
      codeLine: "Tàbí kí ẹ tẹ kóòdù yìí sínú áàpù náà:",
      ignore: "Bí kì í bá ṣe ẹ̀yin ni ẹ béèrè, ẹ kàn sí ẹgbẹ́ wa.",
    },
    email: {
      subject: "Kóòdù ìwọlé yín",
      intro: "Èyí ni kóòdù ìwọlé Wanyiyi yín.",
      button: "Wọlé",
      codeLine: "Kóòdù yín:",
      ignore: "Bí kì í bá ṣe ẹ̀yin ni ẹ béèrè, ẹ fojú fo ìfiránṣẹ́ yìí.",
    },
    reauthentication: {
      subject: "Ẹ jẹ́rìí pé ẹ̀yin gan-an ni",
      intro: "Láti jẹ́rìí sí ìgbésẹ̀ yìí lórí àkáǹtì Wanyiyi yín, ẹ tẹ kóòdù ìsàlẹ̀ yìí.",
      button: "Ṣí Wanyiyi",
      codeLine: "Kóòdù yín:",
      ignore: "Bí kì í bá ṣe ẹ̀yin ni ẹ béèrè, ẹ kàn sí ẹgbẹ́ wa.",
    },
  },
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * E-mail sobre, aux couleurs de la marque (noir encre, ivoire, rose profond), sans couleur dorée.
 * HTML en tableaux et styles en ligne : seule forme fiable dans les messageries.
 */
export function authEmail(locale: Locale, action: EmailAction, link: string, code: string) {
  const t = EMAIL_TEXTS[locale][action];
  const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(t.subject)}</title></head>
<body style="margin:0;padding:0;background:#faf7f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f2;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4dfd7;">
<tr><td style="padding:36px 36px 8px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:28px;color:#0e0d10;">wanyiyi</td></tr>
<tr><td style="padding:16px 36px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:#0e0d10;">${escapeHtml(t.subject)}</td></tr>
<tr><td style="padding:16px 36px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#47423b;">${escapeHtml(t.intro)}</td></tr>
<tr><td style="padding:28px 36px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#a63a50;color:#faf7f2;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;padding:14px 26px;border-radius:2px;">${escapeHtml(t.button)}</a></td></tr>
<tr><td style="padding:28px 36px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#47423b;">${escapeHtml(t.codeLine)} <strong style="font-size:18px;letter-spacing:4px;color:#0e0d10;">${escapeHtml(code)}</strong></td></tr>
<tr><td style="padding:28px 36px 36px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#7d766c;border-top:0;">${escapeHtml(t.ignore)}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  const text = `${t.subject}\n\n${t.intro}\n\n${link}\n\n${t.codeLine} ${code}\n\n${t.ignore}`;
  return { subject: t.subject, html, text };
}

/** Lien de confirmation documenté par Supabase pour le Send Email Hook. */
export function confirmationLink(supabaseUrl: string, tokenHash: string, action: string, redirectTo: string): string {
  const url = new URL("/auth/v1/verify", supabaseUrl);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", action);
  url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}
