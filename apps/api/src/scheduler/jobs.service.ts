import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { purgeDeletedAccounts } from "../accounts/purge";
import { DeliveriesService } from "../notifications/deliveries.service";
import { PaymentsService } from "../payments/payments.service";
import { createMissingPreviews } from "../photos/previews";
import { SupabaseService } from "../supabase/supabase.service";

/**
 * Tâches planifiées (clé service role, chaque usage journalisé) :
 * - limite des 48 h : libération des places non confirmées et promotion de la liste d'attente ;
 * - calcul des matchs des soirées terminées ;
 * - annonce des matchs à 8 h, heure de Cotonou, avec un rattrapage si l'API était arrêtée à 8 h ;
 * - fin des découvertes à 14 jours (21 avec la prolongation) et des matchs non ouverts à 7 jours
 *   (phase 3, 9.4), message neutre aux deux ;
 * - couples : alerte d'inactivité, pause, effacement des conversations échues (9.5, phase 3) ;
 * - remboursement des soirées annulées (relance si un remboursement a échoué) ;
 * - envoi par SMS et e-mail des notifications des actions groupées (chaque minute) ;
 * - effacement des comptes supprimés depuis 30 jours (chaque nuit, question 17) ;
 * - copies très floutées des photos déposées avant les aperçus de soirée (29 octobre 2026).
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

  /** Places données moins de 48 h avant, non confirmées ou non payées après 2 h (question 9). */
  @Cron("*/5 * * * *", { name: "release-late-promotions", timeZone: "Africa/Porto-Novo" })
  async releaseLatePromotions() {
    if (!this.ready()) return;
    const db = this.supabase.system("libération des places données tard (2 h)");
    const { data: released, error } = await db.rpc("release_late_promotions");
    if (error) this.logger.error(`Places données tard : ${error.message}`);
    else if (released) this.logger.log(`${released} place(s) donnée(s) tard libérée(s)`);
  }

  /** Comptes supprimés depuis 30 jours : données, fichiers du selfie et compte Auth effacés (question 17). */
  @Cron("0 3 * * *", { name: "purge-deleted-accounts", timeZone: "Africa/Porto-Novo" })
  async purgeDeletedAccounts() {
    if (!this.ready()) return;
    await purgeDeletedAccounts(this.supabase.system("effacement des comptes supprimés depuis 30 jours"), this.logger);
  }

  /** Copies floutées manquantes, par petits lots (aperçu des participants d'une soirée). */
  @Cron("*/15 * * * *", { name: "photo-previews", timeZone: "Africa/Porto-Novo" })
  async photoPreviews() {
    if (!this.ready()) return;
    await createMissingPreviews(this.supabase.system("copies floutées des photos pour l'aperçu des soirées"), this.logger);
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

  /** Découvertes arrivées à échéance et matchs jamais ouverts après 7 jours (9.4, question 2). */
  @Cron("*/15 * * * *", { name: "expire-discoveries", timeZone: "Africa/Porto-Novo" })
  async expireDiscoveries() {
    if (!this.ready()) return;
    const db = this.supabase.system("fin des découvertes et des matchs non ouverts");
    const { data: count, error } = await db.rpc("expire_discoveries");
    if (error) return this.logger.error(`Fin des découvertes : ${error.message}`);
    if (count) this.logger.log(`${count} découverte(s) ou match(s) arrivé(s) à échéance`);
  }

  /** Couples sans activité : alerte à 60 jours, pause 14 jours plus tard (9.5, question 6). */
  @Cron("0 * * * *", { name: "couple-inactivity", timeZone: "Africa/Porto-Novo" })
  async coupleInactivity() {
    if (!this.ready()) return;
    const db = this.supabase.system("inactivité des couples (alerte et pause)");
    const { data: count, error } = await db.rpc("couple_inactivity");
    if (error) return this.logger.error(`Inactivité des couples : ${error.message}`);
    if (count) this.logger.log(`${count} couple(s) alerté(s) ou mis en pause`);
  }

  /** Badges de confiance attribués ou retirés selon leurs conditions (phase 4, question 5 b et d). */
  @Cron("15 4 * * *", { name: "trust-badges", timeZone: "Africa/Porto-Novo" })
  async refreshTrustBadges() {
    if (!this.ready()) return;
    const db = this.supabase.system("attribution quotidienne des badges de confiance");
    const { data: count, error } = await db.rpc("refresh_trust_badges");
    if (error) return this.logger.error(`Badges de confiance : ${error.message}`);
    if (count) this.logger.log(`${count} badge(s) attribué(s) ou retiré(s)`);
  }

  /** Cagnottes arrivées à leur date de fin : fermées, reversement proposé au couple (phase 4, question 3 f). */
  @Cron("*/15 * * * *", { name: "close-cagnottes", timeZone: "Africa/Porto-Novo" })
  async closeCagnottes() {
    if (!this.ready()) return;
    const db = this.supabase.system("clôture des cagnottes échues");
    const { data: count, error } = await db.rpc("close_due_cagnottes");
    if (error) return this.logger.error(`Clôture des cagnottes : ${error.message}`);
    if (count) this.logger.log(`${count} cagnotte(s) clôturée(s)`);
  }

  /** Conversations échues effacées : 90 jours après une séparation ou un départ, 12 mois après l'union (9.5). */
  @Cron("30 3 * * *", { name: "purge-conversations", timeZone: "Africa/Porto-Novo" })
  async purgeConversations() {
    if (!this.ready()) return;
    const db = this.supabase.system("effacement des conversations échues");
    const { data: count, error } = await db.rpc("purge_conversations");
    if (error) return this.logger.error(`Effacement des conversations : ${error.message}`);
    if (count) this.logger.log(`${count} message(s) effacé(s)`);
  }

  /**
   * « Bien rentré(e) ? » (question 5) : message 3 heures après un rendez-vous déclaré, rappel à
   * 12 heures, alerte à l'équipe sans réponse 24 heures après le rendez-vous.
   */
  @Cron("*/15 * * * *", { name: "date-checkins", timeZone: "Africa/Porto-Novo" })
  async dateCheckins() {
    if (!this.ready()) return;
    const db = this.supabase.system("messages « Bien rentré(e) ? » et alertes");
    const { data: count, error } = await db.rpc("process_date_checkins");
    if (error) return this.logger.error(`Bien rentré(e) : ${error.message}`);
    if (count) this.logger.log(`${count} message(s) ou alerte(s) « Bien rentré(e) ? »`);
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
