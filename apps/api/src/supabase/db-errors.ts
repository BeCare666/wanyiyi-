import { BadRequestException, ConflictException, ForbiddenException, HttpException, InternalServerErrorException, NotFoundException } from "@nestjs/common";

/**
 * Traduit les erreurs métier levées par les fonctions SQL (migration de la phase 2)
 * en réponses HTTP. Le code renvoyé au client est la clé de traduction côté site.
 */
const BY_CODE: Record<string, (code: string) => HttpException> = {
  forbidden: (c) => new ForbiddenException(c),
  forbidden_column: (c) => new ForbiddenException(c),
  not_authenticated: (c) => new ForbiddenException(c),
  not_validated: (c) => new ForbiddenException(c),
  couple_exclusivity: (c) => new ForbiddenException(c),
  blocked_until: (c) => new ForbiddenException(c),
  theme_age: (c) => new ForbiddenException(c),
  theme_religion: (c) => new ForbiddenException(c),
  theme_sector: (c) => new ForbiddenException(c),
  already_registered: (c) => new ConflictException(c),
  evening_closed: (c) => new ConflictException(c),
  confirmation_closed: (c) => new ConflictException(c),
  not_booked: (c) => new ConflictException(c),
  not_registered: (c) => new NotFoundException(c),
  not_confirmed: (c) => new ConflictException(c),
  already_prepared: (c) => new ConflictException(c),
  not_prepared: (c) => new ConflictException(c),
  not_enough_participants: (c) => new ConflictException(c),
  invalid_status: (c) => new ConflictException(c),
  evening_not_finished: (c) => new ConflictException(c),
  outside_evening: (c) => new ForbiddenException(c),
  not_in_round: (c) => new ForbiddenException(c),
  pause_round: (c) => new ConflictException(c),
  not_found: (c) => new NotFoundException(c),
};

export function toHttpError(error: { message?: string; code?: string } | null | undefined): HttpException {
  const message = error?.message ?? "";
  const toError = BY_CODE[message];
  if (toError) return toError(message);
  if (error?.code === "42501") return new ForbiddenException("forbidden");
  if (error?.code === "23514") return new BadRequestException("check_violation");
  return new InternalServerErrorException("database_error");
}

/** Lève l'erreur HTTP correspondante si la réponse Supabase contient une erreur. */
export function unwrap<T>(result: { data: T; error: { message?: string; code?: string } | null }): T {
  if (result.error) throw toHttpError(result.error);
  return result.data;
}
