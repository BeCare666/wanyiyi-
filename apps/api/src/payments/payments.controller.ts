import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import { ZodBody } from "../common/zod-body";
import { FEEXPAY_NETWORKS, type FeexpayNetwork } from "./feexpay";
import { PaymentsService } from "./payments.service";

const phone = z.string().trim().min(8).max(20);
const text = (max: number) => z.string().trim().min(1).max(max);

/** Paiement Mobile Money : réseau du Bénin et numéro qui recevra la demande. */
const mobileSchema = z.object({
  network: z.enum(Object.keys(FEEXPAY_NETWORKS) as [FeexpayNetwork, ...FeexpayNetwork[]]),
  phone,
});

/** Paiement par carte : coordonnées du titulaire exigées par FeexPay. */
const cardSchema = z.object({
  firstName: text(60),
  lastName: text(60),
  email: z.string().trim().email().max(120),
  phoneNumber: phone,
  city: text(60),
  zip: text(10),
});

@ApiTags("Paiements")
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("evenings/:eventId")
  @ApiOperation({ summary: "Payer une soirée réservée (renvoie l'adresse de paiement)" })
  start(@CurrentMember() member: AuthenticatedMember, @Param("eventId", ParseUUIDPipe) eventId: string) {
    return this.payments.startEveningPayment(member.id, member.accessToken, eventId);
  }

  @Get(":paymentId")
  @ApiOperation({ summary: "Paiement du membre : montant, état et moyens de paiement proposés" })
  info(@CurrentMember() member: AuthenticatedMember, @Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.checkoutInfo(member.id, paymentId);
  }

  @Post(":paymentId/feexpay/mobile")
  @HttpCode(200)
  @ApiOperation({ summary: "Paiement Mobile Money par FeexPay : demande envoyée au téléphone du membre" })
  payByMobile(
    @CurrentMember() member: AuthenticatedMember,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Body(new ZodBody(mobileSchema)) { network, phone }: z.infer<typeof mobileSchema>,
  ) {
    return this.payments.payByMobile(member.id, paymentId, network, phone);
  }

  @Post(":paymentId/feexpay/card")
  @HttpCode(200)
  @ApiOperation({ summary: "Paiement par carte : renvoie la page de paiement FeexPay" })
  payByCard(
    @CurrentMember() member: AuthenticatedMember,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Body(new ZodBody(cardSchema)) holder: z.infer<typeof cardSchema>,
  ) {
    return this.payments.payByCard(member.id, paymentId, holder);
  }

  @Post(":paymentId/feexpay/refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Vérifier la demande FeexPay en cours (statut relu chez FeexPay)" })
  refresh(@CurrentMember() member: AuthenticatedMember, @Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.refreshFeexpay(member.id, paymentId);
  }

  @Post("simulated/:paymentId/succeed")
  @HttpCode(204)
  @ApiOperation({ summary: "Démonstration : valider un paiement simulé (interdit en production)" })
  succeed(@CurrentMember() member: AuthenticatedMember, @Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.succeedSimulated(member.id, paymentId);
  }
}

/** Référence envoyée par le webhook FeexPay ; le reste du message n'est pas cru. */
const webhookSchema = z.object({ reference: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }).passthrough();

/**
 * Webhook FeexPay (tableau de bord FeexPay > Webhook, adresse https://<api>/api/payments/feexpay/webhook).
 * Non signé par FeexPay : il ne fait que déclencher la relecture du statut chez FeexPay.
 */
@ApiTags("Paiements")
@Controller("payments/feexpay")
export class FeexpayWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("webhook")
  @HttpCode(200)
  @ApiOperation({ summary: "Webhook FeexPay : relecture du statut de la transaction" })
  async webhook(@Body(new ZodBody(webhookSchema)) { reference }: z.infer<typeof webhookSchema>) {
    await this.payments.feexpayWebhook(reference);
    return { received: true };
  }
}
