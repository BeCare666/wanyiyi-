import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import webpush from "web-push";
import type { Env } from "../config/env";
import { unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";

type PendingPush = {
  delivery_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: string;
};

/** Contenu affiché par le service worker (public/sw.js). */
export type PushContent = { title: string; body: string; url: string; tag: string };

/**
 * Texte discret sur l'écran verrouillé (décision du 04/11/2026) : ni prénom, ni détail, quelle
 * que soit la notification. Toucher la notification ouvre la page « Notifications » de l'espace.
 */
const discreetBody: Record<string, string> = {
  fr: "Vous avez une nouvelle notification.",
  en: "You have a new notification.",
  yo: "Ẹ ní ìfitónilétí tuntun.",
};

export function pushContent(locale: string): PushContent {
  const lang = locale in discreetBody ? locale : "fr";
  return {
    title: "Ifedele",
    body: discreetBody[lang]!,
    // Le français, langue source, n'a pas de préfixe dans les adresses du site
    url: `${lang === "fr" ? "" : `/${lang}`}/espace/notifications`,
    tag: "ifedele",
  };
}

/** Appareil disparu : l'abonnement est à supprimer (documentation Web Push, RFC 8030). */
export function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

/**
 * Notifications sur le téléphone (web push, décisions du 04/11/2026) : chaque notification de
 * l'espace part sur chaque appareil abonné par le membre. Tâche système, journalisée. Sans clés
 * VAPID dans la configuration, rien n'est envoyé (les envois restent en file 24 h).
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger("Notifications sur le téléphone");
  private readonly configured: boolean;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService<Env, true>,
  ) {
    const publicKey = config.get("VAPID_PUBLIC_KEY", { infer: true });
    const privateKey = config.get("VAPID_PRIVATE_KEY", { infer: true });
    const subject = config.get("VAPID_SUBJECT", { infer: true });
    this.configured = Boolean(publicKey && privateKey && subject);
    if (this.configured) webpush.setVapidDetails(subject!, publicKey!, privateKey!);
    else this.logger.warn("Clés VAPID absentes : aucune notification n'est envoyée sur les téléphones");
  }

  async dispatch(): Promise<{ sent: number; failed: number; gone: number }> {
    const counts = { sent: 0, failed: 0, gone: 0 };
    if (!this.configured) return counts;
    const db = this.supabase.system("envoi des notifications sur le téléphone");
    const pending = (unwrap(await db.rpc("pending_push_deliveries", { p_limit: 100 })) ?? []) as PendingPush[];

    for (const push of pending) {
      const subscription = { endpoint: push.endpoint, keys: { p256dh: push.p256dh, auth: push.auth } };
      try {
        await webpush.sendNotification(subscription, JSON.stringify(pushContent(push.locale)), { TTL: 60 * 60 * 24, urgency: "normal" });
        unwrap(await db.rpc("mark_push_delivery", { p_delivery: push.delivery_id, p_ok: true }));
        counts.sent += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        const gone = isGone(statusCode);
        const message = statusCode ? `réponse ${statusCode}` : (error as Error).message;
        if (!gone) this.logger.error(`Envoi ${push.delivery_id} : ${message}`);
        unwrap(await db.rpc("mark_push_delivery", { p_delivery: push.delivery_id, p_ok: false, p_error: message, p_gone: gone }));
        if (gone) counts.gone += 1;
        else counts.failed += 1;
      }
    }
    if (pending.length > 0) this.logger.log(`${counts.sent} envoyée(s), ${counts.failed} en échec, ${counts.gone} appareil(s) retiré(s)`);
    return counts;
  }

  /** Envois de plus de 30 jours supprimés (journal léger). */
  async purge(): Promise<number> {
    const db = this.supabase.system("purge des envois sur le téléphone");
    return (unwrap(await db.rpc("purge_push_deliveries")) as number | null) ?? 0;
  }
}
