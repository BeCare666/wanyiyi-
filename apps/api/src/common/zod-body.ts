import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/** Valide le corps d'une requête avec un schéma Zod (types partagés, messages courts). */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "invalid_body",
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
      });
    }
    return result.data;
  }
}
