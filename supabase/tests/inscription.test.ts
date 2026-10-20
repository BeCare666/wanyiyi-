import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";

/**
 * Inscription d'un nouveau membre (section 6.2-2, décisions du 19 octobre 2026) :
 * compte créé par le code SMS, consentement, identité déclarée, 18 ans révolus.
 */

let db: PGlite;
let phoneCounter = 0;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** Compte tout juste créé par Supabase Auth (vérification du code SMS), sans profil. */
async function newAccount(): Promise<string> {
  const id = randomUUID();
  phoneCounter += 1;
  await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `+22901960${String(phoneCounter).padStart(5, "0")}`]);
  return id;
}

/** Date de naissance donnant cet âge (moins un jour de marge) au jour de Cotonou. */
function bornYearsAgo(years: number, dayOffset = 0): string {
  const today = new Date(Date.now() + 3600_000);
  const d = new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate() + dayOffset));
  return d.toISOString().slice(0, 10);
}

const register = (userId: string, args: { birth?: string; consent?: boolean; first?: string; city?: string | null } = {}) =>
  asUser(db, userId, async (tx) => {
    const error = await failure(
      tx.query("select app.complete_registration($1, 'Fictif', 'female', $2, $3, $4)", [
        args.first ?? "Mahougnon",
        args.birth ?? "1995-04-12",
        args.city === undefined ? " Cotonou " : args.city,
        args.consent ?? true,
      ]),
    );
    if (error) return { error };
    const [profile] = (
      await tx.query<{ first_name: string; city: string | null; status: string; journey_stage: string }>(
        "select first_name, city, status, journey_stage from app.member_profiles where user_id = $1",
        [userId],
      )
    ).rows;
    const [user] = (await tx.query<{ consent_at: string | null; member_number: string }>("select consent_at, member_number from app.users where id = $1", [userId])).rows;
    // Journal lisible par la seule super administration : lecture avec les droits de la base
    await tx.exec("reset role");
    const audited = (await tx.query("select 1 from app.audit_log where action = 'member.registered' and target_id = $1", [userId])).rows.length;
    return { error, profile, user, audited };
  });

describe("Inscription (6.2-2)", () => {
  it("le compte né du code SMS a un numéro de membre ; l'identité crée le profil « en inscription », consentement daté, journalisé", async () => {
    const id = await newAccount();
    const result = await register(id);
    expect(result.error).toBeNull();
    expect(result.profile).toEqual({ first_name: "Mahougnon", city: "Cotonou", status: "registering", journey_stage: "registration" });
    expect(result.user?.consent_at).not.toBeNull();
    expect(result.user?.member_number).toMatch(/^W\d{6}$/);
    expect(result.audited).toBe(1);
  });

  it("18 ans révolus au jour de Cotonou : la veille des 18 ans refusée, le jour même accepté", async () => {
    expect((await register(await newAccount(), { birth: bornYearsAgo(18, 1) })).error).toMatch(/too_young/);
    expect((await register(await newAccount(), { birth: bornYearsAgo(18) })).error).toBeNull();
    expect((await register(await newAccount(), { birth: bornYearsAgo(80) })).error).toBeNull(); // aucun âge maximum
  });

  it("consentement, nom, date et ville contrôlés ; une seule inscription par compte", async () => {
    expect((await register(await newAccount(), { consent: false })).error).toMatch(/consent_required/);
    expect((await register(await newAccount(), { first: "  " })).error).toMatch(/invalid_name/);
    expect((await register(await newAccount(), { birth: bornYearsAgo(-1) })).error).toMatch(/invalid_birth_date/);
    expect((await register(await newAccount(), { city: "x".repeat(81) })).error).toMatch(/invalid_city/);
    expect((await register(await newAccount(), { city: null })).profile?.city).toBeNull();

    const id = await newAccount();
    await db.query(
      "insert into app.member_profiles (user_id, first_name, last_name, sex, birth_date) values ($1, 'Déjà', 'Fictif', 'male', '1990-01-01')",
      [id],
    );
    expect((await register(id)).error).toMatch(/already_registered/);
  });

  it("visiteur sans compte : refusé", async () => {
    expect((await register(randomUUID())).error).toMatch(/forbidden/);
  });
});
