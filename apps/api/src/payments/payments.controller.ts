import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import { ZodBody } from "../common/zod-body";
import { PaymentsService } from "./payments.service";

/** Référence de transaction renvoyée par le widget KkiaPay (lettres et chiffres). */
const kkiapaySchema = z.object({ transactionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

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
  @ApiOperation({ summary: "Paiement du membre : montant, état et réglages publics du widget KkiaPay" })
  info(@CurrentMember() member: AuthenticatedMember, @Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.checkoutInfo(member.id, paymentId);
  }

  @Post(":paymentId/kkiapay")
  @HttpCode(200)
  @ApiOperation({ summary: "Fin du paiement dans le widget KkiaPay : transaction vérifiée auprès de KkiaPay" })
  confirmKkiapay(
    @CurrentMember() member: AuthenticatedMember,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Body(new ZodBody(kkiapaySchema)) { transactionId }: z.infer<typeof kkiapaySchema>,
  ) {
    return this.payments.confirmKkiapay(member.id, paymentId, transactionId);
  }

  @Post("simulated/:paymentId/succeed")
  @HttpCode(204)
  @ApiOperation({ summary: "Démonstration : valider un paiement simulé (interdit en production)" })
  succeed(@CurrentMember() member: AuthenticatedMember, @Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.succeedSimulated(member.id, paymentId);
  }
}
