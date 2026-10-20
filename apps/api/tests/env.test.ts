import { describe, expect, it } from "vitest";
import { validateEnv } from "../src/config/env";

describe("Configuration de l'API", () => {
  it("applique les valeurs par défaut en développement", () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PAYMENT_PROVIDER).toBe("simulated");
    expect(env.KKIAPAY_SANDBOX).toBe(true);
  });

  it("considère une valeur vide comme non renseignée", () => {
    expect(validateEnv({ BREVO_API_KEY: "  " }).BREVO_API_KEY).toBeUndefined();
  });

  it("refuse une URL Supabase invalide", () => {
    expect(() => validateEnv({ SUPABASE_URL: "pas-une-url" })).toThrow(/SUPABASE_URL/);
  });

  it("KkiaPay (20 octobre 2026) : trois clés exigées, bac à sable interdit en production", () => {
    expect(() => validateEnv({ PAYMENT_PROVIDER: "kkiapay", KKIAPAY_PUBLIC_KEY: "pk" })).toThrow(/KKIAPAY_PRIVATE_KEY/);
    const keys = { PAYMENT_PROVIDER: "kkiapay", KKIAPAY_PUBLIC_KEY: "pk", KKIAPAY_PRIVATE_KEY: "tpk", KKIAPAY_SECRET: "tsk" };
    expect(validateEnv(keys).KKIAPAY_SANDBOX).toBe(true);
    expect(validateEnv({ ...keys, KKIAPAY_SANDBOX: "false" }).KKIAPAY_SANDBOX).toBe(false);
    expect(() => validateEnv({ ...keys, NODE_ENV: "production" })).toThrow(/KKIAPAY_SANDBOX/);
    expect(() => validateEnv({ ...keys, KKIAPAY_SANDBOX: "oui" })).toThrow(/KKIAPAY_SANDBOX/);
  });
});
