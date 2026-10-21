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

  it("production (20 octobre 2026) : hook e-mail exigé, hook SMS facultatif, adresse publique du site", () => {
    const base = {
      NODE_ENV: "production",
      SUPABASE_URL: "https://p.supabase.co",
      SUPABASE_ANON_KEY: "a",
      SUPABASE_SERVICE_ROLE_KEY: "s",
      SEND_EMAIL_HOOK_SECRET: "v1,whsec_x",
      SMS_PROVIDER: "brevo",
      EMAIL_PROVIDER: "brevo",
      BREVO_API_KEY: "k",
      BREVO_SMS_SENDER: "Ifedele",
      BREVO_SENDER_EMAIL: "contact@wanyiyi.example",
      PAYMENT_PROVIDER: "kkiapay",
      KKIAPAY_PUBLIC_KEY: "pk",
      KKIAPAY_PRIVATE_KEY: "pk2",
      KKIAPAY_SECRET: "sk",
      KKIAPAY_SANDBOX: "false",
      WEB_ORIGIN: "https://wanyiyi.example",
    };
    expect(validateEnv(base).SEND_SMS_HOOK_SECRET).toBeUndefined();
    expect(() => validateEnv({ ...base, SEND_EMAIL_HOOK_SECRET: "" })).toThrow(/SEND_EMAIL_HOOK_SECRET/);
    expect(() => validateEnv({ ...base, WEB_ORIGIN: "http://localhost:3000" })).toThrow(/WEB_ORIGIN/);
  });
});
