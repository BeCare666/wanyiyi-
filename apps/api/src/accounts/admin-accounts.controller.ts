import { Body, Controller, HttpCode, Logger, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import { ZodBody } from "../common/zod-body";
import { unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";
import { cleanAccount } from "./purge";

const deletionSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

/**
 * Suppression immédiate d'un compte par la super administration (décision du 29 octobre 2026) :
 * 1. app.admin_delete_account, avec le jeton de la personne : la base contrôle la permission
 *    accounts.delete, exige le motif, efface les données et journalise ;
 * 2. fichiers (selfie, photos) et compte Supabase Auth effacés aussitôt : tâche système, clé
 *    service role journalisée. En cas d'échec, la tâche de nuit reprend le compte.
 */
@ApiTags("Administration des comptes")
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller("admin/accounts")
export class AdminAccountsController {
  private readonly logger = new Logger(AdminAccountsController.name);

  constructor(private readonly supabase: SupabaseService) {}

  @Post(":id/delete")
  @HttpCode(200)
  @ApiOperation({ summary: "Supprimer un compte tout de suite, sans délai ni retour (super administration, motif obligatoire)" })
  async remove(
    @CurrentMember() member: AuthenticatedMember,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodBody(deletionSchema)) { reason }: z.infer<typeof deletionSchema>,
  ) {
    unwrap(await this.supabase.forMember(member.accessToken).rpc("admin_delete_account", { p_user: id, p_reason: reason }));
    try {
      await cleanAccount(this.supabase.system("effacement des fichiers et du compte Auth après une suppression par la super administration"), id);
      return { cleaned: true };
    } catch (e) {
      this.logger.error(`Compte ${id} : ${(e as Error).message} (repris par la tâche de nuit)`);
      return { cleaned: false };
    }
  }
}
