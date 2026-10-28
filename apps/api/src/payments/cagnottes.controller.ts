import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodBody } from "../common/zod-body";
import { FEEXPAY_NETWORKS, type FeexpayNetwork } from "./feexpay";
import { PaymentsService } from "./payments.service";

/** Lien public de la cagnotte : 64 caractères hexadécimaux (app.answer_cagnotte). */
const TOKEN = /^[0-9a-f]{64}$/;

const contributionSchema = z.object({
  name: z.string().trim().max(60).nullable().default(null),
  anonymous: z.boolean().default(false),
  message: z.string().trim().max(300).nullable().default(null),
  amountXof: z.number().int().positive().max(10_000_000),
  hideAmount: z.boolean().default(false),
});

const mobileSchema = z.object({
  network: z.enum(Object.keys(FEEXPAY_NETWORKS) as [FeexpayNetwork, ...FeexpayNetwork[]]),
  phone: z.string().trim().min(8).max(20),
});

/**
 * Contributions aux cagnottes (phase 4, question 3 b) : toute personne qui a le lien, sans compte.
 * La base contrôle tout (cagnotte ouverte, montant minimal, nom, message filtré) ; le paiement se
 * fait par Mobile Money via FeexPay, demandé par l'API (la clé ne va jamais dans le navigateur).
 * Seules les contributions (paiements sans membre) passent par ces routes.
 */
@ApiTags("Cagnottes")
@Controller("cagnottes")
export class CagnottesController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":token/contributions")
  @ApiOperation({ summary: "Préparer une contribution (renvoie l'identifiant du paiement)" })
  start(@Param("token") token: string, @Body(new ZodBody(contributionSchema)) body: z.infer<typeof contributionSchema>) {
    if (!TOKEN.test(token)) throw new NotFoundException("not_found");
    return this.payments.startContribution(token, {
      name: body.anonymous ? null : body.name || null,
      anonymous: body.anonymous,
      message: body.message || null,
      amountXof: body.amountXof,
      hideAmount: body.hideAmount,
    });
  }

  @Get("contributions/:paymentId")
  @ApiOperation({ summary: "Contribution : montant, état et réseaux Mobile Money proposés" })
  info(@Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.contributionInfo(paymentId);
  }

  @Post("contributions/:paymentId/mobile")
  @HttpCode(200)
  @ApiOperation({ summary: "Payer la contribution par Mobile Money (FeexPay)" })
  pay(@Param("paymentId", ParseUUIDPipe) paymentId: string, @Body(new ZodBody(mobileSchema)) { network, phone }: z.infer<typeof mobileSchema>) {
    return this.payments.payByMobile(null, paymentId, network, phone);
  }

  @Post("contributions/:paymentId/refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Vérifier la demande FeexPay en cours" })
  refresh(@Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.refreshFeexpay(null, paymentId);
  }

  @Post("contributions/:paymentId/simulated")
  @HttpCode(204)
  @ApiOperation({ summary: "Démonstration : valider une contribution simulée (interdit en production)" })
  simulated(@Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.payments.succeedSimulatedContribution(paymentId);
  }
}
