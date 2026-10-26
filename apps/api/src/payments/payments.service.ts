import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { toHttpError, unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";
import { beninPhone, type CardHolder, FEEXPAY_NETWORKS, FeexpayClient, FeexpayError, type FeexpayNetwork, type FeexpayTransaction, outcomeOf, rejectTransaction } from "./feexpay";

/**
 * Paiements Mobile Money et carte par adaptateur (section 2 de la note, PROPOSITIONS.txt point 2).
 * FeexPay retenu le 22 octobre 2026 (question 29, à la place de KkiaPay) ; l'adaptateur simulé
 * sert au développement. Aucun montant n'est inventé : sans tarif en base, le paiement est refusé.
 */

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

/** Page de paiement du site ; la référence FeexPay n'existe qu'une fois le moyen de paiement choisi. */
export type Checkout = { providerTransactionId: string | null; checkoutUrl: string };

export interface PaymentProvider {
  readonly name: "simulated" | "feexpay";
  createCheckout(input: { paymentId: string; amountXof: number; description: string }): Promise<Checkout>;
  /**
   * Remboursement intégral automatique d'un paiement reçu (annulation d'une soirée). Absent quand
   * le remboursement se fait à la main : FeexPay (décision du 22 octobre 2026).
   */
  refund?(input: { paymentId: string; providerTransactionId: string | null; amountXof: number }): Promise<void>;
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
 * FeexPay : le membre choisit son réseau (MTN, Moov, Celtiis) ou la carte sur la page
 * /paiement/<id> du site ; l'API demande le paiement à FeexPay, puis relit son statut
 * (PaymentsService.payByMobile, payByCard, refreshFeexpay). Pas de remboursement automatique.
 */
export class FeexpayPaymentProvider implements PaymentProvider {
  readonly name = "feexpay" as const;
  constructor(
    readonly client: FeexpayClient,
    readonly sandbox: boolean,
    readonly webOrigin: string,
  ) {}

  async createCheckout({ paymentId }: { paymentId: string }): Promise<Checkout> {
    return { providerTransactionId: null, checkoutUrl: this.pageOf(paymentId) };
  }

  pageOf(paymentId: string): string {
    return `${this.webOrigin.replace(/\/+$/, "")}/paiement/${paymentId}`;
  }
}

/** Libellés envoyés à FeexPay : sans caractères spéciaux, 40 caractères au plus. */
const FEEXPAY_DESCRIPTIONS: Record<string, string> = { counselor_access: "Conseiller ifedele" };
export function feexpayDescription(purpose: string): string {
  return FEEXPAY_DESCRIPTIONS[purpose] ?? "Soiree ifedele";
}

type FeexpayPayment = {
  id: string;
  user_id: string;
  purpose: string;
  amount_xof: number;
  status: string;
  provider: string;
  provider_transaction_id: string | null;
};

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
    const checkout = await this.provider.createCheckout({ paymentId: payment.id, amountXof: event.price_xof, description: "Soirée Ifedele" });
    if (checkout.providerTransactionId) {
      unwrap(await system.from("payments").update({ provider_transaction_id: checkout.providerTransactionId }).eq("id", payment.id));
    }
    return { paymentId: payment.id, checkoutUrl: checkout.checkoutUrl };
  }

  /**
   * Paiement de l'accès au conseiller (règles du 26 octobre 2026) : par le membre qui a invité,
   * après l'accord de l'autre, au prix figé à ce moment. La base vérifie tout avec le jeton du
   * membre (app.counselor_access_to_pay) ; aucun remboursement ensuite.
   */
  async startCounselorPayment(memberId: string, accessToken: string, accessId: string) {
    const member = this.supabase.forMember(accessToken);
    const amount = unwrap(await member.rpc("counselor_access_to_pay", { p_access: accessId })) as number;
    const system = this.supabase.system(`création du paiement de l'accès au conseiller ${accessId} pour ${memberId}`);
    const payment = unwrap(
      await system
        .from("payments")
        .insert({ user_id: memberId, purpose: "counselor_access", amount_xof: amount, provider: this.provider.name })
        .select("id")
        .single(),
    );
    if (!payment) throw new ConflictException("payment_not_created");
    unwrap(await system.from("counselor_access").update({ payment_id: payment.id }).eq("id", accessId));
    const checkout = await this.provider.createCheckout({ paymentId: payment.id, amountXof: amount, description: "Conseiller Ifedele" });
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

  /**
   * Paiement du membre, pour la page de paiement : montant, état, moyens proposés et, pour
   * FeexPay, demande en attente de validation (le membre la vérifie au lieu de payer deux fois).
   */
  async checkoutInfo(memberId: string, paymentId: string) {
    const system = this.supabase.system(`lecture du paiement ${paymentId} par son membre`);
    const payment = unwrap(
      await system.from("payments").select("id, user_id, purpose, amount_xof, status, provider, provider_transaction_id").eq("id", paymentId).maybeSingle(),
    );
    if (!payment || payment.user_id !== memberId) throw new NotFoundException("not_found");
    const feexpay =
      this.provider instanceof FeexpayPaymentProvider && payment.provider === "feexpay"
        ? {
            sandbox: this.provider.sandbox,
            networks: Object.keys(FEEXPAY_NETWORKS) as FeexpayNetwork[],
            awaiting: payment.status === "pending" && payment.provider_transaction_id !== null,
          }
        : null;
    return { paymentId: payment.id, purpose: payment.purpose, amountXof: payment.amount_xof, status: payment.status, provider: payment.provider, feexpay };
  }

  private feexpay(): FeexpayPaymentProvider {
    if (!(this.provider instanceof FeexpayPaymentProvider)) throw new ForbiddenException("feexpay_disabled");
    return this.provider;
  }

  private async feexpayPayment(paymentId: string, reason: string): Promise<FeexpayPayment> {
    const system = this.supabase.system(reason);
    const payment = unwrap(
      await system.from("payments").select("id, user_id, purpose, amount_xof, status, provider, provider_transaction_id").eq("id", paymentId).maybeSingle(),
    ) as FeexpayPayment | null;
    if (!payment || payment.provider !== "feexpay") throw new NotFoundException("not_found");
    return payment;
  }

  /** Appel FeexPay : erreurs traduites pour le membre, détail dans le journal seulement. */
  private async callFeexpay<T>(paymentId: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.error(`Paiement ${paymentId} : appel FeexPay en échec (${(error as Error).message})`);
      // 400 : demande refusée par FeexPay (numéro invalide, par exemple). Clé refusée (401),
      // panne ou délai dépassé : problème de configuration ou de prestataire
      if (error instanceof FeexpayError && error.status === 400) throw new ConflictException("payment_refused");
      throw new ServiceUnavailableException("feexpay_unavailable");
    }
  }

  /**
   * Avant une nouvelle demande : la précédente est relue chez FeexPay. Réussie, elle règle le
   * paiement ; encore en attente, elle bloque une seconde demande (pas de double paiement).
   */
  private async beforeNewAttempt(payment: FeexpayPayment): Promise<"succeeded" | null> {
    if (payment.status === "succeeded") return "succeeded";
    if (payment.status !== "pending") throw new ConflictException("invalid_status");
    if (!payment.provider_transaction_id) return null;
    const previous = await this.settle(payment);
    if (previous.status === "pending") throw new ConflictException("payment_in_progress");
    return previous.status === "succeeded" ? "succeeded" : null;
  }

  /** Référence FeexPay de la demande en cours, gardée sur le paiement (unique en base). */
  private async keepReference(paymentId: string, reference: string) {
    const system = this.supabase.system(`référence FeexPay du paiement ${paymentId}`);
    const { error } = await system.from("payments").update({ provider_transaction_id: reference }).eq("id", paymentId).eq("status", "pending");
    if (error?.code === "23505") throw new ConflictException("transaction_already_used");
    if (error) throw toHttpError(error);
  }

  /** Paiement Mobile Money : la demande arrive sur le téléphone du membre, qui la valide. */
  async payByMobile(memberId: string, paymentId: string, network: FeexpayNetwork, phone: string) {
    const provider = this.feexpay();
    const payment = await this.feexpayPayment(paymentId, `paiement Mobile Money ${paymentId}`);
    if (payment.user_id !== memberId) throw new NotFoundException("not_found");
    const phoneNumber = beninPhone(phone);
    if (!phoneNumber) throw new ConflictException("invalid_phone");
    if ((await this.beforeNewAttempt(payment)) === "succeeded") return { status: "succeeded" as const };

    const transaction = await this.callFeexpay(paymentId, () =>
      provider.client.requestMobile({ network, phoneNumber, amountXof: payment.amount_xof, description: feexpayDescription(payment.purpose), paymentId }),
    );
    await this.keepReference(paymentId, transaction.reference);
    this.logger.log(`Paiement ${paymentId} : demande ${network} envoyée à FeexPay`);
    // Statut final parfois immédiat (MTN, Moov) : toujours relu par la route de statut
    if (outcomeOf(transaction.status) === "pending") return { status: "pending" as const };
    return this.settle({ ...payment, provider_transaction_id: transaction.reference });
  }

  /** Paiement par carte : renvoie la page FeexPay où le membre saisit sa carte. */
  async payByCard(memberId: string, paymentId: string, holder: CardHolder) {
    const provider = this.feexpay();
    const payment = await this.feexpayPayment(paymentId, `paiement par carte ${paymentId}`);
    if (payment.user_id !== memberId) throw new NotFoundException("not_found");
    const phoneNumber = beninPhone(holder.phoneNumber);
    if (!phoneNumber) throw new ConflictException("invalid_phone");
    if ((await this.beforeNewAttempt(payment)) === "succeeded") return { status: "succeeded" as const, paymentUrl: null };

    const session = await this.callFeexpay(paymentId, () =>
      provider.client.initCard({
        holder: { ...holder, phoneNumber },
        amountXof: payment.amount_xof,
        description: feexpayDescription(payment.purpose),
        paymentId,
        returnUrl: provider.pageOf(paymentId),
      }),
    );
    await this.keepReference(paymentId, session.reference);
    this.logger.log(`Paiement ${paymentId} : page de paiement par carte ouverte chez FeexPay`);
    return { status: "pending" as const, paymentUrl: session.paymentUrl };
  }

  /** Le membre vérifie sa demande en cours (retour de la page carte, validation sur le téléphone). */
  async refreshFeexpay(memberId: string, paymentId: string) {
    this.feexpay();
    const payment = await this.feexpayPayment(paymentId, `vérification FeexPay du paiement ${paymentId}`);
    if (payment.user_id !== memberId) throw new NotFoundException("not_found");
    if (payment.status === "succeeded") return { status: "succeeded" as const };
    if (payment.status !== "pending" || !payment.provider_transaction_id) throw new ConflictException("invalid_status");
    return this.settle(payment);
  }

  /**
   * Webhook FeexPay (non signé) : seule la référence est lue, puis le statut est relu chez FeexPay.
   * Référence inconnue ou paiement déjà réglé : rien à faire.
   */
  async feexpayWebhook(reference: string) {
    if (!(this.provider instanceof FeexpayPaymentProvider)) return;
    const system = this.supabase.system(`webhook FeexPay ${reference}`);
    const payment = unwrap(
      await system
        .from("payments")
        .select("id, user_id, amount_xof, status, provider, provider_transaction_id")
        .eq("provider", "feexpay")
        .eq("provider_transaction_id", reference)
        .maybeSingle(),
    ) as FeexpayPayment | null;
    if (!payment || payment.status !== "pending") return;
    await this.settle(payment).catch((error: Error) => this.logger.error(`Webhook FeexPay ${reference} : ${error.message}`));
  }

  /**
   * Statut de la demande en cours, relu chez FeexPay avec la clé de l'API. Réussie, du montant
   * exact et liée à ce paiement : le paiement est marqué réussi et journalisé. Échouée : le
   * paiement reste à régler, le membre peut refaire une demande.
   */
  private async settle(payment: FeexpayPayment): Promise<{ status: "succeeded" | "pending" | "failed"; reason?: string }> {
    const provider = this.feexpay();
    const reference = payment.provider_transaction_id!;
    const transaction: FeexpayTransaction = await this.callFeexpay(payment.id, () => provider.client.status(reference));
    const outcome = outcomeOf(transaction.status);
    if (outcome === "pending") return { status: "pending" };
    if (outcome === "failed") {
      this.logger.warn(`Paiement ${payment.id} : demande FeexPay échouée (${transaction.reason ?? "sans motif"})`);
      return { status: "failed", reason: transaction.reason ?? undefined };
    }
    const rejected = rejectTransaction(transaction, { id: payment.id, amountXof: payment.amount_xof, reference });
    if (rejected) {
      // Argent reçu mais non rattachable : à rapprocher à la main par l'équipe
      this.logger.error(`Paiement ${payment.id} : transaction FeexPay ${reference} réussie mais refusée (${rejected})`);
      throw new ConflictException(rejected);
    }
    const system = this.supabase.system(`paiement ${payment.id} réglé par FeexPay`);
    const { data: updated, error } = await system
      .from("payments")
      .update({ status: "succeeded" })
      .eq("id", payment.id)
      .eq("status", "pending")
      .eq("provider_transaction_id", reference)
      .select("id");
    if (error) throw toHttpError(error);
    // Déjà réglé entre-temps (webhook et membre en même temps) : rien de plus
    if (!updated || updated.length === 0) return { status: "succeeded" };
    unwrap(
      await system.from("audit_log").insert({
        actor_id: payment.user_id,
        action: "payment.succeeded",
        target_table: "payments",
        target_id: payment.id,
        details: { provider: "feexpay", reference },
      }),
    );
    this.logger.log(`Paiement ${payment.id} réglé par FeexPay`);
    return { status: "succeeded" };
  }

  /**
   * Remboursements demandés par l'annulation d'une soirée (app.cancel_event). Automatiques
   * seulement quand l'adaptateur sait rembourser (démonstration) ; les paiements FeexPay restent
   * « à rembourser » : l'équipe rembourse depuis le tableau de bord FeexPay, puis les marque
   * remboursés dans l'administration (décision du 22 octobre 2026). Tâche système, journalisée.
   */
  async refundPending(): Promise<{ refunded: number; failed: number; manual: number }> {
    const db = this.supabase.system("remboursement des soirées annulées");
    const pending = unwrap(await db.rpc("pending_refunds")) as Array<{
      payment_id: string;
      amount_xof: number;
      provider: string;
      provider_transaction_id: string | null;
    }> | null;
    let refunded = 0;
    let failed = 0;
    let manual = 0;
    for (const payment of pending ?? []) {
      if (payment.provider !== this.provider.name || !this.provider.refund) {
        manual += 1;
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
    return { refunded, failed, manual };
  }
}
