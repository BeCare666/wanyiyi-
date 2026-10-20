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
export const SUPPORTED_EMAIL_ACTIONS = ["signup", "recovery", "email_change", "email", "reauthentication"] as const;
export type EmailAction = (typeof SUPPORTED_EMAIL_ACTIONS)[number];

/** codeLine : seulement pour les e-mails à code (connexion, réauthentification) ; les autres se confirment par le lien. */
type EmailText = { subject: string; intro: string; button: string; codeLine?: string; ignore: string };

const EMAIL_TEXTS: Record<Locale, Record<EmailAction, EmailText>> = {
  fr: {
    signup: {
      subject: "Confirmez votre adresse e-mail",
      intro: "Merci de votre inscription chez Wanyiyi. Pour confirmer votre adresse e-mail, utilisez le bouton ci-dessous.",
      button: "Confirmer mon adresse",
      ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    },
    recovery: {
      subject: "Choisissez un nouveau mot de passe",
      intro: "Vous avez demandé à changer le mot de passe de votre compte Wanyiyi. Utilisez le bouton ci-dessous pour en choisir un nouveau. Ce lien ne sert qu'une fois.",
      button: "Choisir un mot de passe",
      ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
    },
    email_change: {
      subject: "Confirmez votre nouvelle adresse e-mail",
      intro: "Vous avez demandé à changer l'adresse e-mail de votre compte Wanyiyi. Confirmez-la avec le bouton ci-dessous.",
      button: "Confirmer la nouvelle adresse",
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
      ignore: "If you did not make this request, you can ignore this message.",
    },
    recovery: {
      subject: "Choose a new password",
      intro: "You asked to change the password of your Wanyiyi account. Please use the button below to choose a new one. This link works only once.",
      button: "Choose a password",
      ignore: "If you did not make this request, you can ignore this message: your password stays the same.",
    },
    email_change: {
      subject: "Confirm your new email address",
      intro: "You asked to change the email address of your Wanyiyi account. Please confirm it with the button below.",
      button: "Confirm the new address",
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
      ignore: "Bí kì í bá ṣe ẹ̀yin ni ẹ béèrè, ẹ fojú fo ìfiránṣẹ́ yìí.",
    },
    recovery: {
      subject: "Ẹ yan ọ̀rọ̀ aṣínà tuntun",
      intro: "Ẹ béèrè láti yí ọ̀rọ̀ aṣínà àkáǹtì Wanyiyi yín padà. Ẹ tẹ bọ́tìnnì ìsàlẹ̀ yìí láti yan òmíràn. Ẹ̀ẹ̀kan ṣoṣo ni ìjápọ̀ yìí wúlò.",
      button: "Yan ọ̀rọ̀ aṣínà",
      ignore: "Bí kì í bá ṣe ẹ̀yin ni ẹ béèrè, ẹ fojú fo ìfiránṣẹ́ yìí: ọ̀rọ̀ aṣínà yín kò yí padà.",
    },
    email_change: {
      subject: "Ẹ jẹ́rìí sí àdírẹ́sì ímeèlì tuntun yín",
      intro: "Ẹ béèrè láti yí àdírẹ́sì ímeèlì àkáǹtì Wanyiyi yín padà. Ẹ jẹ́rìí sí i pẹ̀lú bọ́tìnnì ìsàlẹ̀ yìí.",
      button: "Jẹ́rìí sí àdírẹ́sì tuntun",
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
 * Les paragraphes sont du texte brut, échappé ; `extraHtml` est déjà construit et échappé.
 */
export function emailLayout(input: {
  locale: Locale;
  title: string;
  paragraphs: string[];
  button: { label: string; href: string };
  extraHtml?: string;
  footer: string;
}): string {
  const paragraphs = input.paragraphs
    .map(
      (p) =>
        `<tr><td style="padding:16px 36px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#47423b;">${escapeHtml(p).replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:#faf7f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f2;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4dfd7;">
<tr><td style="padding:36px 36px 8px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:28px;color:#0e0d10;">wanyiyi</td></tr>
<tr><td style="padding:16px 36px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:#0e0d10;">${escapeHtml(input.title)}</td></tr>
${paragraphs}
<tr><td style="padding:28px 36px 0;"><a href="${escapeHtml(input.button.href)}" style="display:inline-block;background:#a63a50;color:#faf7f2;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;padding:14px 26px;border-radius:2px;">${escapeHtml(input.button.label)}</a></td></tr>
${input.extraHtml ?? ""}
<tr><td style="padding:28px 36px 36px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#7d766c;border-top:0;">${escapeHtml(input.footer)}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function authEmail(locale: Locale, action: EmailAction, link: string, code: string) {
  const t = EMAIL_TEXTS[locale][action];
  const html = emailLayout({
    locale,
    title: t.subject,
    paragraphs: [t.intro],
    button: { label: t.button, href: link },
    extraHtml: t.codeLine
      ? `<tr><td style="padding:28px 36px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#47423b;">${escapeHtml(t.codeLine)} <strong style="font-size:18px;letter-spacing:4px;color:#0e0d10;">${escapeHtml(code)}</strong></td></tr>`
      : undefined,
    footer: t.ignore,
  });
  const text = `${t.subject}\n\n${t.intro}\n\n${link}\n\n${t.codeLine ? `${t.codeLine} ${code}\n\n` : ""}${t.ignore}`;
  return { subject: t.subject, html, text };
}

/**
 * Lien de l'e-mail : page /confirmation du site, dans la langue du membre, qui vérifie le jeton
 * côté serveur (verifyOtp avec token_hash, méthode documentée par Supabase pour le rendu serveur).
 * Il fonctionne aussi ouvert sur un autre appareil que celui de l'inscription.
 * Réauthentification : code seul, le lien ouvre simplement le site.
 */
export function confirmationLink(webOrigin: string, locale: Locale, tokenHash: string, action: EmailAction): string {
  const base = webOrigin.replace(/\/+$/, "") + (locale === "fr" ? "" : `/${locale}`);
  if (action === "reauthentication") return `${base}/`;
  const url = new URL(`${base}/confirmation`);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", action);
  return url.toString();
}
