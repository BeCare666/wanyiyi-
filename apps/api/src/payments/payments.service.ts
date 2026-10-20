import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { toHttpError, unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";
import { KkiapayClient, KkiapayError, type KkiapayTransaction, rejectTransaction } from "./kkiapay";

/**
 * Paiements Mobile Money par adaptateur (section 2 de la note, PROPOSITIONS.txt point 2).
 * KkiaPay retenu le 20 octobre 2026 (question 7) ; l'adaptateur simulé sert au développement.
 * Aucun montant n'est inventé : sans tarif en base, le paiement est refusé.
 */

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

/** Page de paiement du site ; la référence du prestataire n'existe parfois qu'après le paiement (KkiaPay). */
export type Checkout = { providerTransactionId: string | null; checkoutUrl: string };

export interface PaymentProvider {
  readonly name: "simulated" | "kkiapay";
  createCheckout(input: { paymentId: string; amountXof: number; description: string }): Promise<Checkout>;
  /** Remboursement intégral d'un paiement reçu (annulation d'une soirée, décision du 19 octobre 2026). */
  refund(input: { paymentId: string; providerTransactionId: string | null; amountXof: number }): Promise<void>;
}

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = "simulated" as const;
  constructor(private readonly webOrigin: string) {}

  async createCheckout({ paymentId }: { paymentId: string }): Promise<Checkout> {
    // Page de démonstration du site : elle appelle POST /api/payments/simulated/:id/succeed
    return { providerTransactionId: `sim_${paymentId}`, checkoutUrl: `${this.webOrigin}/paiement-simule/${paymentId}` };
  }

  /** Démonstration : aucun argent ne circule, le remboursement réussit immédiatement. */
  async refund(): Promise<void> {}
}

/**
 * KkiaPay : le membre paie dans le widget officiel, ouvert par la page /paiement/<id> du site ;
 * la transaction est ensuite vérifiée par l'API auprès de KkiaPay (PaymentsService.confirmKkiapay).
 */
export class KkiapayPaymentProvider implements PaymentProvider {
  readonly name = "kkiapay" as const;
  constructor(
    readonly client: KkiapayClient,
    readonly publicKey: string,
    readonly sandbox: boolean,
    private readonly webOrigin: string,
  ) {}

  async createCheckout({ paymentId }: { paymentId: string }): Promise<Checkout> {
    return { providerTransactionId: null, checkoutUrl: `${this.webOrigin.replace(/\/+$/, "")}/paiement/${paymentId}` };
  }

  async refund({ providerTransactionId }: { providerTransactionId: string | null }): Promise<void> {
    if (!providerTransactionId) throw new Error("référence KkiaPay absente");
    await this.client.refund(providerTransactionId);
  }
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger("Paiements");

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** Paiement d'une soirée réservée par le membre. */
  async startEveningPayment(memberId: string, accessToken: string, eventId: string) {
    const member = this.supabase.forMember(accessToken);
    // Lecture avec le jeton du membre : il ne voit que sa propre inscription
    const registration = unwrap(
      await member.from("event_registrations").select("id, status, payment_id").eq("event_id", eventId).maybeSingle(),
    );
    if (!registration || !["booked", "confirmed"].includes(registration.status)) throw new NotFoundException("not_registered");
    const event = unwrap(await member.from("events").select("price_xof").eq("id", eventId).maybeSingle());
    if (!event) throw new NotFoundException("not_found");
    if (!event.price_xof) throw new ConflictException("price_not_set");

    const system = this.supabase.system(`création du paiement de soirée ${eventId} pour ${memberId}`);
    const payment = unwrap(
      await system
        .from("payments")
        .insert({ user_id: memberId, purpose: "evening_booking", amount_xof: event.price_xof, provider: this.provider.name })
        .select("id")
        .single(),
    );
    if (!payment) throw new ConflictException("payment_not_created");
    unwrap(await system.from("event_registrations").update({ payment_id: payment.id }).eq("id", registration.id));
    const checkout = await this.provider.createCheckout({ paymentId: payment.id, amountXof: event.price_xof, description: "Soirée Wanyiyi" });
    if (checkout.providerTransactionId) {
      unwrap(await system.from("payments").update({ provider_transaction_id: checkout.providerTransactionId }).eq("id", payment.id));
    }
    return { paymentId: payment.id, checkoutUrl: checkout.checkoutUrl };
  }

  /** Démonstration uniquement : marque un paiement simulé comme réussi. */
  async succeedSimulated(memberId: string, paymentId: string) {
    if (this.provider.name !== "simulated" || this.config.get("NODE_ENV", { infer: true }) === "production") {
      throw new ForbiddenException("simulated_payments_disabled");
    }
    const system = this.supabase.system(`paiement simulé ${paymentId} validé`);
    const payment = unwrap(await system.from("payments").select("id, user_id, status, provider").eq("id", paymentId).maybeSingle());
    if (!payment || payment.user_id !== memberId || payment.provider !== "simulated") throw new NotFoundException("not_found");
    if (payment.status !== "pending") throw new ConflictException("invalid_status");
    unwrap(await system.from("payments").update({ status: "succeeded" }).eq("id", paymentId));
    unwrap(
      await system.from("audit_log").insert({ actor_id: memberId, action: "payment.simulated_succeeded", target_table: "payments", target_id: paymentId }),
    );
    this.logger.log(`Paiement simulé ${paymentId} validé`);
  }

  /** Paiement du membre, pour la page de paiement : montant, état et réglages publics du widget. */
  async checkoutInfo(memberId: string, paymentId: string) {
    const system = this.supabase.system(`lecture du paiement ${paymentId} par son membre`);
    const payment = unwrap(
      await system.from("payments").select("id, user_id, purpose, amount_xof, status, provider").eq("id", paymentId).maybeSingle(),
    );
    if (!payment || payment.user_id !== memberId) throw new NotFoundException("not_found");
    const widget =
      this.provider instanceof KkiapayPaymentProvider && payment.provider === "kkiapay"
        ? { publicKey: this.provider.publicKey, sandbox: this.provider.sandbox }
        : null;
    return { paymentId: payment.id, purpose: payment.purpose, amountXof: payment.amount_xof, status: payment.status, provider: payment.provider, widget };
  }

  /**
   * Fin du paiement dans le widget KkiaPay : la transaction est relue chez KkiaPay avec les clés
   * privées (jamais sur la seule parole du navigateur), puis le paiement est marqué réussi s'il
   * s'agit d'une transaction réussie, du montant exact, liée à ce paiement (partnerId).
   * Une même transaction ne peut payer qu'un paiement (référence unique en base). Journalisé.
   */
  async confirmKkiapay(memberId: string, paymentId: string, transactionId: string) {
    if (!(this.provider instanceof KkiapayPaymentProvider)) throw new ForbiddenException("kkiapay_disabled");
    const system = this.supabase.system(`vérification KkiaPay du paiement ${paymentId}`);
    const payment = unwrap(
      await system.from("payments").select("id, user_id, amount_xof, status, provider, provider_transaction_id").eq("id", paymentId).maybeSingle(),
    );
    if (!payment || payment.user_id !== memberId || payment.provider !== "kkiapay") throw new NotFoundException("not_found");
    // Déjà confirmé par cette transaction (double envoi du navigateur) : rien à refaire
    if (payment.status === "succeeded" && payment.provider_transaction_id === transactionId) return { status: "succeeded" as const };
    if (payment.status !== "pending") throw new ConflictException("invalid_status");

    let transaction: KkiapayTransaction;
    try {
      transaction = await this.provider.client.verify(transactionId);
    } catch (error) {
      this.logger.error(`Paiement ${paymentId} : vérification KkiaPay impossible (${(error as Error).message})`);
      // 400 ou 404 : transaction inconnue de KkiaPay. Clé refusée (401, code 4003), panne ou délai
      // dépassé : problème de configuration ou de prestataire, le membre vérifiera de nouveau
      if (error instanceof KkiapayError && (error.status === 400 || error.status === 404)) throw new ConflictException("transaction_not_found");
      throw new ServiceUnavailableException("kkiapay_unavailable");
    }
    const rejected = rejectTransaction(transaction, { id: payment.id, amountXof: payment.amount_xof });
    if (rejected) {
      this.logger.warn(`Paiement ${paymentId} : transaction KkiaPay refusée (${rejected})`);
      throw new ConflictException(rejected);
    }
    const { data: updated, error: updateError } = await system
      .from("payments")
      .update({ status: "succeeded", provider_transaction_id: transactionId })
      .eq("id", paymentId)
      .eq("status", "pending")
      .select("id");
    // Référence unique en base : une transaction déjà utilisée pour un autre paiement est refusée
    if (updateError?.code === "23505") throw new ConflictException("transaction_already_used");
    if (updateError) throw toHttpError(updateError);
    if (!updated || updated.length === 0) throw new ConflictException("invalid_status");
    unwrap(
      await system.from("audit_log").insert({
        actor_id: memberId,
        action: "payment.succeeded",
        target_table: "payments",
        target_id: paymentId,
        details: { provider: "kkiapay", source: transaction.source ?? null },
      }),
    );
    this.logger.log(`Paiement ${paymentId} réglé par KkiaPay`);
    return { status: "succeeded" as const };
  }

  /**
   * Remboursements demandés par l'annulation d'une soirée (app.cancel_event) : montant intégral,
   * par l'adaptateur du prestataire, puis marqués dans la base. Tâche système, journalisée ;
   * relancée par la tâche planifiée si un remboursement échoue.
   */
  async refundPending(): Promise<{ refunded: number; failed: number }> {
    const db = this.supabase.system("remboursement des soirées annulées");
    const pending = unwrap(await db.rpc("pending_refunds")) as Array<{
      payment_id: string;
      amount_xof: number;
      provider: string;
      provider_transaction_id: string | null;
    }> | null;
    let refunded = 0;
    let failed = 0;
    for (const payment of pending ?? []) {
      if (payment.provider !== this.provider.name) {
        // Paiement d'un autre prestataire : il attend l'adaptateur correspondant
        this.logger.warn(`Remboursement ${payment.payment_id} : prestataire ${payment.provider} indisponible`);
        failed += 1;
        continue;
      }
      try {
        await this.provider.refund({ paymentId: payment.payment_id, providerTransactionId: payment.provider_transaction_id, amountXof: payment.amount_xof });
        unwrap(await db.rpc("mark_refunded", { p_payment: payment.payment_id }));
        refunded += 1;
      } catch (error) {
        this.logger.error(`Remboursement ${payment.payment_id} : ${(error as Error).message}`);
        failed += 1;
      }
    }
    if (refunded) this.logger.log(`${refunded} remboursement(s) effectué(s)`);
    return { refunded, failed };
  }
}
