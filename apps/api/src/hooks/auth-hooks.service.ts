import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Webhook } from "standardwebhooks";
import type { Env } from "../config/env";
import {
  authEmail,
  confirmationLink,
  type EmailAction,
  otpSms,
  SUPPORTED_EMAIL_ACTIONS,
  toLocale,
} from "../notifications/messages";
import { EMAIL_SENDER, type EmailSender, maskPhone, SMS_SENDER, type SmsSender } from "../notifications/senders";

/**
 * « Auth Hooks » de Supabase (documentation officielle) :
 * - Send Email Hook : e-mails d'authentification envoyés par Brevo, dans la langue du membre
 *   (confirmation de l'inscription, mot de passe oublié, changement d'adresse). Inscription et
 *   connexion par e-mail et mot de passe depuis le 20 octobre 2026 ;
 * - Send SMS Hook : code OTP par SMS. Plus utilisé depuis le 20 octobre 2026 (la connexion par
 *   téléphone est désactivée dans Supabase), gardé pour une réactivation éventuelle.
 * Les requêtes sont signées (bibliothèque standardwebhooks, secret au format v1,whsec_...).
 */

type HookUser = { id: string; phone?: string; email?: string; user_metadata?: Record<string, unknown> };
type SmsPayload = { user: HookUser; sms: { otp: string } };
type EmailPayload = {
  user: HookUser;
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

@Injectable()
export class AuthHooksService {
  private readonly logger = new Logger("Auth Hooks");

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  /** Vérifie la signature et renvoie le contenu de la requête. */
  private verify<T>(secretKey: "SEND_SMS_HOOK_SECRET" | "SEND_EMAIL_HOOK_SECRET", rawBody: string, headers: Record<string, string>): T {
    const secret = this.config.get(secretKey, { infer: true });
    if (!secret) throw new UnauthorizedException("hook_secret_missing");
    try {
      return new Webhook(secret.replace(/^v1,whsec_/, "")).verify(rawBody, headers) as T;
    } catch {
      throw new UnauthorizedException("invalid_signature");
    }
  }

  async sendSms(rawBody: string, headers: Record<string, string>) {
    const { user, sms } = this.verify<SmsPayload>("SEND_SMS_HOOK_SECRET", rawBody, headers);
    if (!user.phone || !/^\d{6}$/.test(sms.otp)) throw new BadRequestException("invalid_payload");
    const locale = toLocale(user.user_metadata?.locale);
    await this.sms.send(`+${user.phone.replace(/^\+/, "")}`, otpSms(locale, sms.otp), "otp");
    this.logger.log(`Code OTP envoyé vers ${maskPhone(user.phone)}`);
  }

  async sendEmail(rawBody: string, headers: Record<string, string>) {
    const { user, email_data: data } = this.verify<EmailPayload>("SEND_EMAIL_HOOK_SECRET", rawBody, headers);
    const action = data.email_action_type as EmailAction;
    if (!SUPPORTED_EMAIL_ACTIONS.includes(action)) {
      // Refus explicite : aucun e-mail d'authentification n'est ignoré en silence
      throw new BadRequestException(`unsupported_email_action:${data.email_action_type}`);
    }
    // Lien vers le site configuré, jamais vers une adresse reçue dans la requête
    const webOrigin = this.config.get("WEB_ORIGIN", { infer: true });
    const locale = toLocale(user.user_metadata?.locale);

    // Changement d'adresse : la documentation inverse les noms des jetons (compatibilité ascendante).
    // Avec le changement sécurisé, chaque adresse reçoit son propre lien.
    const sends: Array<{ to: string; token: string; hash: string }> = [];
    if (action === "email_change" && data.token_hash_new && user.email) {
      sends.push({ to: user.email, token: data.token, hash: data.token_hash_new });
      const newEmail = (user as { new_email?: string }).new_email;
      if (newEmail && data.token_new) sends.push({ to: newEmail, token: data.token_new, hash: data.token_hash });
    } else {
      const to = (user as { new_email?: string }).new_email ?? user.email;
      if (!to) throw new BadRequestException("invalid_payload");
      sends.push({ to, token: data.token || data.token_new || "", hash: data.token_hash || data.token_hash_new || "" });
    }

    for (const s of sends) {
      const link = confirmationLink(webOrigin, locale, s.hash, action);
      const message = authEmail(locale, action, link, s.token);
      await this.email.send({ to: s.to, subject: message.subject, html: message.html, text: message.text, tag: `auth-${action}` });
    }
  }
}
