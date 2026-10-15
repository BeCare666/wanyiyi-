import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
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
  constructor(private readonly supabase: SupabaseService) {}

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
}
