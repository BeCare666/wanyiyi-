import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import { PaymentsService } from "./payments.service";

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

  @Post("simulated/:paymentId/succeed")
  @HttpCode(204)
  @ApiOperation({ summary: "Démonstration : valider un paiement simulé (interdit en production)" })
  succeed(@CurrentMember() member: AuthenticatedMember, @Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.succeedSimulated(member.id, paymentId);
  }
}
