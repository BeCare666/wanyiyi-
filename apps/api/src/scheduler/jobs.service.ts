import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DeliveriesService } from "../notifications/deliveries.service";
import { PaymentsService } from "../payments/payments.service";
import { SupabaseService } from "../supabase/supabase.service";

/**
 * Tâches planifiées (clé service role, chaque usage journalisé) :
 * - limite des 48 h : libération des places non confirmées et promotion de la liste d'attente ;
 * - calcul des matchs des soirées terminées ;
 * - annonce des matchs à 8 h, heure de Cotonou, avec un rattrapage si l'API était arrêtée à 8 h ;
 * - remboursement des soirées annulées (relance si un remboursement a échoué) ;
 * - envoi par SMS et e-mail des notifications des actions groupées (chaque minute).
 * Les règles elles-mêmes sont dans les fonctions SQL : ces tâches ne font que les déclencher.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger("Tâches planifiées");

  private warned = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly payments: PaymentsService,
    private readonly deliveries: DeliveriesService,
  ) {}

  /** Sans projet Supabase configuré, les tâches attendent ; l'avertissement n'est écrit qu'une fois. */
  private ready(): boolean {
    if (this.supabase.isConfigured()) return true;
    if (!this.warned) this.logger.warn("Supabase non configuré : tâches planifiées en attente");
    this.warned = true;
    return false;
  }

  @Cron("*/5 * * * *", { name: "release-unconfirmed", timeZone: "Africa/Porto-Novo" })
  async releaseUnconfirmed(now = new Date()) {
    if (!this.ready()) return;
    const db = this.supabase.system("libération des places non confirmées (48 h)");
    // Soirées à venir dont la limite de confirmation est passée
    const { data: events, error } = await db
      .from("events")
      .select("id, starts_at")
      .in("status", ["published", "full"])
      .gt("starts_at", now.toISOString())
      .lte("starts_at", new Date(now.getTime() + 48 * 3_600_000).toISOString());
    if (error) return this.logger.error(`Lecture des soirées : ${error.message}`);
    for (const event of events ?? []) {
      const { data: released, error: rpcError } = await db.rpc("release_unconfirmed", { p_event: event.id });
      if (rpcError) this.logger.error(`Soirée ${event.id} : ${rpcError.message}`);
      else if (released) this.logger.log(`Soirée ${event.id} : ${released} place(s) libérée(s)`);
    }
  }

  /** Places réservées non payées après 24 h : libérées pour la liste d'attente (question 12). */
  @Cron("*/5 * * * *", { name: "release-unpaid", timeZone: "Africa/Porto-Novo" })
  async releaseUnpaid() {
    if (!this.ready()) return;
    const db = this.supabase.system("libération des places non payées (24 h)");
    const { data: released, error } = await db.rpc("release_unpaid");
    if (error) this.logger.error(`Places non payées : ${error.message}`);
    else if (released) this.logger.log(`${released} place(s) non payée(s) libérée(s)`);
  }

  @Cron("*/5 * * * *", { name: "compute-matches", timeZone: "Africa/Porto-Novo" })
  async computeMatches() {
    if (!this.ready()) return;
    const db = this.supabase.system("calcul des matchs des soirées terminées");
    const { data: events, error } = await db.from("events").select("id").eq("status", "finished").is("results_computed_at", null);
    if (error) return this.logger.error(`Lecture des soirées : ${error.message}`);
    for (const event of events ?? []) {
      const { data: count, error: rpcError } = await db.rpc("compute_matches", { p_event: event.id });
      if (rpcError) this.logger.error(`Soirée ${event.id} : ${rpcError.message}`);
      else this.logger.log(`Soirée ${event.id} : ${count} match(s) calculé(s)`);
    }
  }

  /** 8 h précises à Cotonou. */
  @Cron("0 8 * * *", { name: "announce-matches", timeZone: "Africa/Porto-Novo" })
  async announceAtEight() {
    await this.announceMatches();
  }

  /** Rattrapage toutes les 15 minutes si l'API était arrêtée à 8 h (la fonction ne notifie qu'une fois). */
  @Cron("*/15 * * * *", { name: "announce-matches-catch-up", timeZone: "Africa/Porto-Novo" })
  async announceCatchUp() {
    await this.announceMatches();
  }

  async announceMatches() {
    if (!this.ready()) return;
    const db = this.supabase.system("annonce des matchs (8 h)");
    const { data: count, error } = await db.rpc("announce_matches");
    if (error) return this.logger.error(`Annonce des matchs : ${error.message}`);
    if (count) this.logger.log(`${count} notification(s) de match créée(s)`);
  }

  @Cron("*/5 * * * *", { name: "refund-cancelled-evenings", timeZone: "Africa/Porto-Novo" })
  async refundCancelledEvenings() {
    if (!this.ready()) return;
    try {
      await this.payments.refundPending();
    } catch (error) {
      this.logger.error(`Remboursements : ${(error as Error).message}`);
    }
  }

  @Cron("* * * * *", { name: "send-notifications", timeZone: "Africa/Porto-Novo" })
  async sendNotifications() {
    if (!this.ready()) return;
    try {
      await this.deliveries.dispatch();
    } catch (error) {
      this.logger.error(`Envois des notifications : ${(error as Error).message}`);
    }
  }
}
