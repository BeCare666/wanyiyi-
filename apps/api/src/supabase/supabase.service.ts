import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";
import type { Env } from "../config/env";

function appClient(url: string, key: string, accessToken?: string) {
  return createClient(url, key, {
    db: { schema: "app" },
    auth: { persistSession: false, autoRefreshToken: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}

/** Client Supabase sur le schéma app. */
export type AppClient = ReturnType<typeof appClient>;

/**
 * Accès à Supabase, selon la règle validée (PROPOSITIONS.txt, point 2) :
 * a) pour une requête faite au nom d'un membre, son jeton est transmis : la RLS s'applique ;
 * b) la clé service role sert uniquement aux tâches système, et chaque usage est journalisé.
 */
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger("Supabase");
  private systemClient?: AppClient;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private settings() {
    const url = this.config.get("SUPABASE_URL", { infer: true });
    const anonKey = this.config.get("SUPABASE_ANON_KEY", { infer: true });
    const serviceKey = this.config.get("SUPABASE_SERVICE_ROLE_KEY", { infer: true });
    if (!url || !anonKey) throw new ServiceUnavailableException("supabase_not_configured");
    return { url, anonKey, serviceKey };
  }

  /** Vrai si l'URL et les clés du projet Supabase sont renseignées (tâches système possibles). */
  isConfigured(): boolean {
    const c = this.config;
    return Boolean(c.get("SUPABASE_URL", { infer: true }) && c.get("SUPABASE_ANON_KEY", { infer: true }) && c.get("SUPABASE_SERVICE_ROLE_KEY", { infer: true }));
  }

  /** Client agissant au nom du membre : chaque requête passe par la RLS avec son identité. */
  forMember(accessToken: string): AppClient {
    const { url, anonKey } = this.settings();
    return appClient(url, anonKey, accessToken);
  }

  /**
   * Client système (RLS contournée). `reason` est obligatoire et journalisé :
   * aucun usage silencieux de la clé service role.
   */
  system(reason: string): AppClient {
    const { url, serviceKey } = this.settings();
    if (!serviceKey) throw new ServiceUnavailableException("supabase_service_key_missing");
    this.logger.log(`Clé service role utilisée : ${reason}`);
    this.systemClient ??= appClient(url, serviceKey);
    return this.systemClient;
  }
}
