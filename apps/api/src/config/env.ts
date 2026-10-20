import { z } from "zod";

/** Chaîne facultative : une valeur vide dans .env vaut « non renseignée ». */
const optional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v));

/**
 * Variables d'environnement de l'API, validées au démarrage.
 * Les adaptateurs « simulated » servent au développement et à la démonstration :
 * ils sont interdits en production.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),

  SUPABASE_URL: optional.pipe(z.string().url().optional()),
  SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  // Secrets des « Auth Hooks » Supabase (format v1,whsec_...)
  SEND_SMS_HOOK_SECRET: optional,
  SEND_EMAIL_HOOK_SECRET: optional,

  SMS_PROVIDER: z.enum(["simulated", "brevo"]).default("simulated"),
  EMAIL_PROVIDER: z.enum(["simulated", "brevo"]).default("simulated"),
  // KkiaPay retenu le 20 octobre 2026 (question 7)
  PAYMENT_PROVIDER: z.enum(["simulated", "kkiapay"]).default("simulated"),

  BREVO_API_KEY: optional,
  // Expéditeur des SMS : 11 lettres ou chiffres au maximum (contrainte Brevo)
  BREVO_SMS_SENDER: optional.pipe(z.string().regex(/^[A-Za-z0-9]{1,11}$/, "11 lettres ou chiffres au maximum").optional()),
  BREVO_SENDER_EMAIL: optional.pipe(z.string().email().optional()),
  BREVO_SENDER_NAME: z.string().default("Wanyiyi"),

  CLOUDINARY_CLOUD_NAME: optional,
  CLOUDINARY_API_KEY: optional,
  CLOUDINARY_API_SECRET: optional,

  // KkiaPay : clés du tableau de bord (Développeurs > Clés API) ; bac à sable tant que KKIAPAY_SANDBOX=true
  KKIAPAY_PUBLIC_KEY: optional,
  KKIAPAY_PRIVATE_KEY: optional,
  KKIAPAY_SECRET: optional,
  KKIAPAY_SANDBOX: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

/** Utilisé par ConfigModule : lève une erreur lisible si la configuration est invalide. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration invalide : ${details}`);
  }
  const env = result.data;
  const problems: string[] = [];

  if (env.NODE_ENV === "production") {
    if (env.SMS_PROVIDER === "simulated") problems.push("SMS_PROVIDER ne peut pas être « simulated » en production");
    if (env.EMAIL_PROVIDER === "simulated") problems.push("EMAIL_PROVIDER ne peut pas être « simulated » en production");
    if (env.PAYMENT_PROVIDER === "simulated") problems.push("PAYMENT_PROVIDER ne peut pas être « simulated » en production");
    for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SEND_SMS_HOOK_SECRET", "SEND_EMAIL_HOOK_SECRET"] as const) {
      if (!env[key]) problems.push(`${key} est requise en production`);
    }
  }
  if (env.SMS_PROVIDER === "brevo" && (!env.BREVO_API_KEY || !env.BREVO_SMS_SENDER)) {
    problems.push("BREVO_API_KEY et BREVO_SMS_SENDER sont requises avec SMS_PROVIDER=brevo");
  }
  if (env.EMAIL_PROVIDER === "brevo" && (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL)) {
    problems.push("BREVO_API_KEY et BREVO_SENDER_EMAIL sont requises avec EMAIL_PROVIDER=brevo");
  }
  if (env.PAYMENT_PROVIDER === "kkiapay" && (!env.KKIAPAY_PUBLIC_KEY || !env.KKIAPAY_PRIVATE_KEY || !env.KKIAPAY_SECRET)) {
    problems.push("KKIAPAY_PUBLIC_KEY, KKIAPAY_PRIVATE_KEY et KKIAPAY_SECRET sont requises avec PAYMENT_PROVIDER=kkiapay");
  }
  if (env.NODE_ENV === "production" && env.PAYMENT_PROVIDER === "kkiapay" && env.KKIAPAY_SANDBOX) {
    problems.push("KKIAPAY_SANDBOX doit valoir false en production");
  }
  if (problems.length) throw new Error(`Configuration invalide : ${problems.join("; ")}`);
  return env;
}
