import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";

/**
 * Inscription par e-mail (décision du 20 octobre 2026) : compte sans téléphone, langue reprise
 * de l'inscription, numéro facultatif ajouté par le membre (app.set_phone), non vérifié.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** Compte créé par l'inscription e-mail de Supabase Auth. */
async function emailAccount(locale?: string): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    `${id}@exemple.test`,
    locale === undefined ? null : JSON.stringify({ locale }),
  ]);
  return id;
}

const setPhone = (userId: string, phone: string | null) =>
  asUser(db, userId, async (tx) => {
    const error = await failure(tx.query("select app.set_phone($1)", [phone]));
    if (error) return { error, phone: null, audited: 0 };
    const [user] = (await tx.query<{ phone: string | null }>("select phone from app.users where id = $1", [userId])).rows;
    await tx.exec("reset role");
    const audited = (await tx.query("select 1 from app.audit_log where action = 'member.phone_changed' and target_id = $1", [userId])).rows.length;
    return { error, phone: user?.phone ?? null, audited };
  });

describe("Inscription par e-mail", () => {
  it("compte sans téléphone : numéro de membre attribué, langue de l'inscription reprise", async () => {
    const id = await emailAccount("en");
    const [user] = (await db.query<{ phone: string | null; member_number: string; locale: string }>("select phone, member_number, locale from app.users where id = $1", [id])).rows;
    expect(user).toMatchObject({ phone: null, locale: "en" });
    expect(user?.member_number).toMatch(/^W\d{6}$/);
    const other = await emailAccount("de");
    expect((await db.query<{ locale: string }>("select locale from app.users where id = $1", [other])).rows[0]?.locale).toBe("fr");
    const none = await emailAccount();
    expect((await db.query<{ locale: string }>("select locale from app.users where id = $1", [none])).rows[0]?.locale).toBe("fr");
  });
});

describe("Téléphone facultatif (app.set_phone)", () => {
  it("numéro ajouté au format international (espaces retirés), journalisé ; retiré avec une valeur vide", async () => {
    const id = await emailAccount();
    expect(await setPhone(id, "+229 01 96 00 00 01")).toEqual({ error: null, phone: "+2290196000001", audited: 1 });
    await db.query("update app.users set phone = '+2290196000002' where id = $1", [id]);
    expect((await setPhone(id, "  ")).phone).toBeNull();
  });

  it("format refusé ; numéro déjà pris par un autre compte refusé", async () => {
    const id = await emailAccount();
    expect((await setPhone(id, "0196000003")).error).toMatch(/invalid_phone/);
    const owner = await emailAccount();
    await db.query("update app.users set phone = '+2290196000004' where id = $1", [owner]);
    expect((await setPhone(id, "+2290196000004")).error).toMatch(/phone_taken/);
  });

  it("écriture directe du numéro toujours refusée ; visiteur sans compte refusé", async () => {
    const id = await emailAccount();
    const direct = await asUser(db, id, (tx) => failure(tx.query("update app.users set phone = '+2290196000005' where id = $1", [id])));
    expect(direct).toMatch(/forbidden_column/);
    expect((await setPhone(randomUUID(), "+2290196000006")).error).toMatch(/forbidden/);
  });
});
