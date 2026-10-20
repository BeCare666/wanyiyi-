import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";
import { EMAIL_SENDER, type EmailSender, maskPhone, SMS_SENDER, type SmsSender } from "./senders";
import { deliveryContent } from "./team-messages";

type PendingDelivery = {
  delivery_id: string;
  channel: "sms" | "email" | "whatsapp";
  kind: string;
  payload: unknown;
  locale: string;
  phone: string | null;
  email: string | null;
};

/**
 * File d'envoi des notifications (actions groupées, décisions du 19 octobre 2026) : SMS et e-mail
 * par Brevo, dans la langue du membre, selon les canaux qu'il a choisis (la base ne crée que
 * ceux-là). Tâche système, journalisée ; un échec est retenté par la base jusqu'à 5 fois.
 * Sans téléphone ou sans e-mail confirmé, l'envoi est abandonné sans appel au prestataire.
 */
@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger("Envois des notifications");

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env, true>,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  async dispatch(): Promise<{ sent: number; failed: number; skipped: number }> {
    const db = this.supabase.system("envoi des notifications (SMS et e-mail)");
    const pending = (unwrap(await db.rpc("pending_deliveries", { p_limit: 100 })) ?? []) as PendingDelivery[];
    const webOrigin = this.config.get("WEB_ORIGIN", { infer: true });
    const counts = { sent: 0, failed: 0, skipped: 0 };

    for (const delivery of pending) {
      const content = deliveryContent(delivery.kind, delivery.payload, delivery.locale, webOrigin);
      const address = delivery.channel === "sms" ? delivery.phone : delivery.channel === "email" ? delivery.email : null;
      if (!content || !address) {
        const reason = !content ? `type ${delivery.kind} sans texte d'envoi` : delivery.channel === "email" ? "aucune adresse e-mail confirmée" : "canal sans destinataire";
        unwrap(await db.rpc("mark_delivery", { p_delivery: delivery.delivery_id, p_ok: false, p_error: reason, p_skip: true }));
        counts.skipped += 1;
        continue;
      }
      try {
        if (delivery.channel === "sms") await this.sms.send(address, content.sms, delivery.kind);
        else await this.email.send({ to: address, ...content.email, tag: delivery.kind });
        unwrap(await db.rpc("mark_delivery", { p_delivery: delivery.delivery_id, p_ok: true }));
        counts.sent += 1;
      } catch (error) {
        const message = (error as Error).message;
        this.logger.error(`Envoi ${delivery.channel} ${delivery.delivery_id}${delivery.channel === "sms" ? ` vers ${maskPhone(address)}` : ""} : ${message}`);
        unwrap(await db.rpc("mark_delivery", { p_delivery: delivery.delivery_id, p_ok: false, p_error: message }));
        counts.failed += 1;
      }
    }
    if (counts.sent || counts.failed) this.logger.log(`${counts.sent} envoi(s), ${counts.failed} échec(s), ${counts.skipped} sans destinataire`);
    return counts;
  }
}
