import { Controller, HttpCode, Logger, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import { PaymentsService } from "../payments/payments.service";
import { unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";

/**
 * Pilotage d'une soirée par l'équipe (section 11.2-5). Le jeton de la personne est transmis :
 * la permission « events.manage » est vérifiée dans la base, pas ici.
 */
@ApiTags("Administration des soirées")
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller("admin/events/:id")
export class AdminEventsController {
  private readonly logger = new Logger("Administration des soirées");

  constructor(
    private readonly supabase: SupabaseService,
    private readonly payments: PaymentsService,
  ) {}

  private db(member: AuthenticatedMember) {
    return this.supabase.forMember(member.accessToken);
  }

  @Post("check-in/:userId")
  @HttpCode(204)
  @ApiOperation({ summary: "Pointage à l'entrée d'un participant confirmé" })
  async checkIn(
    @CurrentMember() member: AuthenticatedMember,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    unwrap(await this.db(member).rpc("check_in", { p_event: id, p_user: userId }));
  }

  @Post("prepare")
  @ApiOperation({ summary: "Numérotation, tables, codes QR et rotation des participants pointés" })
  async prepare(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    return { tables: unwrap(await this.db(member).rpc("prepare_evening", { p_event: id })) };
  }

  @Post("start")
  @HttpCode(204)
  @ApiOperation({ summary: "Début de la soirée : les codes QR deviennent utilisables" })
  async start(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    unwrap(await this.db(member).rpc("start_evening", { p_event: id }));
  }

  @Post("finish")
  @HttpCode(204)
  @ApiOperation({ summary: "Fin de la soirée : codes QR fermés, votes figés" })
  async finish(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    unwrap(await this.db(member).rpc("finish_evening", { p_event: id }));
  }

  @Post("compute-matches")
  @ApiOperation({ summary: "Calcul des matchs (annoncés le lendemain à 8 h)" })
  async computeMatches(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    return { matches: unwrap(await this.db(member).rpc("compute_matches", { p_event: id })) };
  }

  @Post("cancel")
  @ApiOperation({
    summary: "Annulation d'une soirée publiée : places annulées, inscrits notifiés, paiements reçus remboursés en entier",
    description: "Les remboursements sont lancés aussitôt ; un échec est relancé par la tâche planifiée.",
  })
  async cancel(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    const refunds = unwrap(await this.db(member).rpc("cancel_event", { p_event: id })) as number;
    if (refunds > 0) {
      await this.payments.refundPending().catch((error: Error) => this.logger.error(`Remboursements de la soirée ${id} : ${error.message}`));
    }
    return { refunds };
  }
}
