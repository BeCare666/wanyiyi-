import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Env } from "../config/env";

export type AuthenticatedMember = { id: string; accessToken: string };

type RequestWithMember = Request & { member?: AuthenticatedMember };

/**
 * Vérifie le jeton Supabase du membre (signature, émetteur, audience, expiration)
 * avec les clés publiques du projet (JWKS), sans appel réseau à chaque requête.
 * Le jeton est ensuite transmis tel quel à Supabase : la RLS décide des droits.
 */
@Injectable()
export class MemberGuard implements CanActivate {
  private jwks?: JWTVerifyGetKey;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Clés de vérification ; remplaçable dans les tests. */
  protected keys(url: string): JWTVerifyGetKey {
    this.jwks ??= createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", url));
    return this.jwks;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithMember>();
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new UnauthorizedException("missing_token");

    const url = this.config.get("SUPABASE_URL", { infer: true });
    if (!url) throw new ServiceUnavailableException("supabase_not_configured");
    try {
      const { payload } = await jwtVerify(token, this.keys(url), {
        issuer: new URL("/auth/v1", url).toString(),
        audience: "authenticated",
      });
      if (typeof payload.sub !== "string") throw new Error("sub");
      request.member = { id: payload.sub, accessToken: token };
      return true;
    } catch {
      throw new UnauthorizedException("invalid_token");
    }
  }
}

/** Membre authentifié par MemberGuard. */
export const CurrentMember = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedMember => {
  const member = context.switchToHttp().getRequest<RequestWithMember>().member;
  if (!member) throw new UnauthorizedException("missing_token");
  return member;
});
