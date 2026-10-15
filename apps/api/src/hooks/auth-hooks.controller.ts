import { Controller, HttpCode, Post, type RawBodyRequest, Req } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthHooksService } from "./auth-hooks.service";

/** En-têtes sous forme simple, pour la vérification de signature. */
function headersOf(request: Request): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v ?? "")]),
  );
}

/** Appelé uniquement par Supabase Auth (requêtes signées). Réponse vide 200 = succès. */
@ApiExcludeController()
@Controller("hooks/auth")
export class AuthHooksController {
  constructor(private readonly hooks: AuthHooksService) {}

  @Post("sms")
  @HttpCode(200)
  async sms(@Req() request: RawBodyRequest<Request>) {
    await this.hooks.sendSms(request.rawBody?.toString("utf8") ?? "", headersOf(request));
    return {};
  }

  @Post("email")
  @HttpCode(200)
  async email(@Req() request: RawBodyRequest<Request>) {
    await this.hooks.sendEmail(request.rawBody?.toString("utf8") ?? "", headersOf(request));
    return {};
  }
}
