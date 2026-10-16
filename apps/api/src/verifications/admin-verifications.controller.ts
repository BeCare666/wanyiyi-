import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import { SupabaseService } from "../supabase/supabase.service";
import { documentLink } from "./document-link";

/**
 * Vérifications côté équipe (section 11.2-3). La file et la décision passent par les
 * fonctions SQL avec le jeton de la personne ; seule l'ouverture d'une pièce passe par
 * l'API, qui crée le lien signé de courte durée.
 */
@ApiTags("Administration des vérifications")
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller("admin/verifications")
export class AdminVerificationsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Post("documents/:id/link")
  @ApiOperation({ summary: "Lien signé (5 minutes) vers une pièce ou un selfie ; chaque ouverture est journalisée" })
  link(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    return documentLink(this.supabase.forMember(member.accessToken), (reason) => this.supabase.system(reason), id, member.id);
  }
}
