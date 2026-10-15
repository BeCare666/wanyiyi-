import { Logger } from "@nestjs/common";

/**
 * Adaptateurs d'envoi. La version « simulée » écrit dans le journal du serveur
 * (développement et démonstration uniquement : interdite en production par la configuration).
 * La version Brevo suit la documentation officielle (API v3) :
 * - SMS : POST https://api.brevo.com/v3/transactionalSMS/send (sender, recipient, content, type)
 * - E-mail : POST https://api.brevo.com/v3/smtp/email (sender, to, subject, htmlContent, textContent)
 */

export const SMS_SENDER = Symbol("SMS_SENDER");
export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

export interface SmsSender {
  send(to: string, text: string, tag: string): Promise<void>;
}

export type EmailMessage = { to: string; subject: string; html: string; text: string; tag: string };

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Numéro masqué pour le journal : jamais de numéro complet dans les logs. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

export class SimulatedSmsSender implements SmsSender {
  private readonly logger = new Logger("SMS simulé");
  readonly sent: Array<{ to: string; text: string; tag: string }> = [];

  async send(to: string, text: string, tag: string) {
    this.sent.push({ to, text, tag });
    // En développement, le texte (et donc le code) est lisible dans le journal pour pouvoir se connecter
    this.logger.log(`${tag} vers ${maskPhone(to)} : ${text}`);
  }
}

export class SimulatedEmailSender implements EmailSender {
  private readonly logger = new Logger("E-mail simulé");
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
    this.logger.log(`${message.tag} vers ${maskEmail(message.to)} : ${message.subject}\n${message.text}`);
  }
}

export class BrevoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function brevoPost(apiKey: string, path: string, body: unknown, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`https://api.brevo.com/v3${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Le corps d'erreur de Brevo ne contient pas de donnée personnelle ; il est tronqué par prudence
    const detail = (await response.text()).slice(0, 300);
    throw new BrevoError(response.status, `Brevo ${path} : ${response.status} ${detail}`);
  }
}

export class BrevoSmsSender implements SmsSender {
  constructor(
    private readonly apiKey: string,
    private readonly sender: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, text: string, tag: string) {
    await brevoPost(
      this.apiKey,
      "/transactionalSMS/send",
      // unicodeEnabled : nécessaire pour les lettres accentuées du français et du yoruba
      { sender: this.sender, recipient: to.replace(/^\+/, ""), content: text, type: "transactional", tag, unicodeEnabled: true },
      this.fetchImpl,
    );
  }
}

export class BrevoEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly senderEmail: string,
    private readonly senderName: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send({ to, subject, html, text, tag }: EmailMessage) {
    await brevoPost(
      this.apiKey,
      "/smtp/email",
      {
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        tags: [tag],
      },
      this.fetchImpl,
    );
  }
}
