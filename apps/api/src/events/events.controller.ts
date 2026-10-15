import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import { ZodBody } from "../common/zod-body";
import { unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";

const voteSchema = z.object({
  choice: z.enum(["yes", "no"]),
  // Appréciation facultative, visible uniquement par l'équipe
  respect: z.number().int().min(1).max(5).optional(),
  punctuality: z.number().int().min(1).max(5).optional(),
  seriousness: z.number().int().min(1).max(5).optional(),
});

/**
 * Soirées côté membre (section 6.2-4 et 6.2-5). Toutes les requêtes partent avec
 * le jeton du membre : les règles 9.2 et 9.3 sont appliquées par les fonctions SQL et la RLS.
 */
@ApiTags("Soirées")
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller()
export class EventsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get("events")
  @ApiOperation({ summary: "Soirées publiées, avec les places restantes par sexe" })
  async list(@CurrentMember() member: AuthenticatedMember) {
    const db = this.supabase.forMember(member.accessToken);
    const events = unwrap(
      await db
        .from("events")
        .select("id, starts_at, status, price_xof, capacity_women, capacity_men, theme:themes(key, min_age, max_age)")
        .in("status", ["published", "full"])
        .gte("starts_at", new Date().toISOString())
        .order("starts_at"),
    );
    return Promise.all(
      (events ?? []).map(async (event) => ({
        ...event,
        seats: unwrap(await db.rpc("event_seats", { p_event: event.id })),
      })),
    );
  }

  @Post("events/:id/book")
  @ApiOperation({ summary: "Réserver : place attribuée (seat) ou liste d'attente (waitlist)" })
  async book(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    const outcome = unwrap(await this.supabase.forMember(member.accessToken).rpc("book_event", { p_event: id }));
    return { outcome };
  }

  @Post("events/:id/confirm")
  @HttpCode(204)
  @ApiOperation({ summary: "Confirmer sa place (jusqu'à 48 h avant)" })
  async confirm(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    unwrap(await this.supabase.forMember(member.accessToken).rpc("confirm_registration", { p_event: id }));
  }

  @Post("events/:id/cancel")
  @HttpCode(204)
  @ApiOperation({ summary: "Annuler sa réservation ou quitter la liste d'attente" })
  async cancel(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    unwrap(await this.supabase.forMember(member.accessToken).rpc("cancel_registration", { p_event: id }));
  }

  @Get("vote/:qr/rounds/:round")
  @ApiOperation({ summary: "Personne rencontrée à ce tour (prénom seulement) et vote déjà donné" })
  async partner(
    @CurrentMember() member: AuthenticatedMember,
    @Param("qr") qr: string,
    @Param("round", ParseIntPipe) round: number,
  ) {
    const rows = unwrap(await this.supabase.forMember(member.accessToken).rpc("round_partner", { p_qr_token: qr, p_round: round }));
    return rows?.[0] ?? null;
  }

  @Post("vote/:qr/rounds/:round")
  @HttpCode(204)
  @ApiOperation({ summary: "Voter après un tour (modifiable jusqu'à la fin de la soirée)" })
  async vote(
    @CurrentMember() member: AuthenticatedMember,
    @Param("qr") qr: string,
    @Param("round", ParseIntPipe) round: number,
    @Body(new ZodBody(voteSchema)) body: z.infer<typeof voteSchema>,
  ) {
    unwrap(
      await this.supabase.forMember(member.accessToken).rpc("cast_vote", {
        p_qr_token: qr,
        p_round: round,
        p_choice: body.choice,
        p_respect: body.respect ?? null,
        p_punctuality: body.punctuality ?? null,
        p_seriousness: body.seriousness ?? null,
      }),
    );
  }

  @Get("matches")
  @ApiOperation({ summary: "Mes matchs annoncés (prénom de l'autre personne seulement)" })
  async matches(@CurrentMember() member: AuthenticatedMember) {
    return unwrap(await this.supabase.forMember(member.accessToken).rpc("my_matches"));
  }
}
