import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";

/**
 * Paiements Mobile Money par adaptateur (section 2 de la note, PROPOSITIONS.txt point 2).
 * Seul l'adaptateur simulé existe : FedaPay ou KkiaPay attendent la réponse à la question 7
 * (PHASE2.txt). Aucun montant n'est inventé : sans tarif en base, le paiement est refusé.
 */

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export type Checkout = { providerTransactionId: string; checkoutUrl: string };

export interface PaymentProvider {
  readonly name: "simulated" | "fedapay";
  createCheckout(input: { paymentId: string; amountXof: number; description: string }): Promise<Checkout>;
}

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = "simulated" as const;
  constructor(private readonly webOrigin: string) {}

  async createCheckout({ paymentId }: { paymentId: string }): Promise<Checkout> {
    // Page de démonstration du site : elle appelle POST /api/payments/simulated/:id/succeed
    return { providerTransactionId: `sim_${paymentId}`, checkoutUrl: `${this.webOrigin}/paiement-simule/${paymentId}` };
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
    unwrap(await system.from("payments").update({ provider_transaction_id: checkout.providerTransactionId }).eq("id", payment.id));
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
}
