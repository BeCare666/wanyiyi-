import { Body, Controller, HttpCode, Param, Put, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { checkFreeText } from "@wanyiyi/domain";
import { z } from "zod";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import { ZodBody } from "../common/zod-body";
import { unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";

const FIELDS = ["who_i_am", "what_matters", "evening_topic"] as const;
const textSchema = z.object({ body: z.string().trim().min(1) });

/**
 * Textes libres du profil (section 8.1) : blocage côté serveur des numéros, liens,
 * adresses e-mail et pseudos, puis enregistrement « en relecture » (la base l'impose).
 */
@ApiTags("Profil")
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller("profile/texts")
export class ProfileController {
  constructor(private readonly supabase: SupabaseService) {}

  @Put(":field")
  @HttpCode(204)
  @ApiOperation({ summary: "Enregistrer un texte libre (bloqué s'il contient des coordonnées)" })
  async save(
    @CurrentMember() member: AuthenticatedMember,
    @Param("field") field: string,
    @Body(new ZodBody(textSchema)) { body }: z.infer<typeof textSchema>,
  ) {
    if (!FIELDS.includes(field as (typeof FIELDS)[number])) throw new UnprocessableEntityException("unknown_field");
    const issues = checkFreeText(body);
    if (issues.length) throw new UnprocessableEntityException({ message: "text_rejected", issues });
    unwrap(
      await this.supabase
        .forMember(member.accessToken)
        .from("profile_texts")
        .upsert({ user_id: member.id, field, body }, { onConflict: "user_id,field" }),
    );
  }
}
