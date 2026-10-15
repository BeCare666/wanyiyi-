import { describe, expect, it } from "vitest";
import { validateEnv } from "../src/config/env";

describe("Configuration de l'API", () => {
  it("applique les valeurs par défaut en développement", () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.FEDAPAY_ENVIRONMENT).toBe("sandbox");
  });

  it("considère une valeur vide comme non renseignée", () => {
    expect(validateEnv({ BREVO_API_KEY: "  " }).BREVO_API_KEY).toBeUndefined();
  });

  it("refuse une URL Supabase invalide", () => {
    expect(() => validateEnv({ SUPABASE_URL: "pas-une-url" })).toThrow(/SUPABASE_URL/);
  });

  it("refuse le mode live de FedaPay sans clé en production", () => {
    expect(() => validateEnv({ NODE_ENV: "production", FEDAPAY_ENVIRONMENT: "live" })).toThrow(/FEDAPAY_SECRET_KEY/);
  });
});
