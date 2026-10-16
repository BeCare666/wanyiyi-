import { randomBytes } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { Webhook } from "standardwebhooks";
import { describe, expect, it, vi } from "vitest";
import { MemberGuard } from "../src/auth/member.guard";
import { type Env, validateEnv } from "../src/config/env";
import { AuthHooksService } from "../src/hooks/auth-hooks.service";
import { authEmail, confirmationLink, otpSms, SUPPORTED_EMAIL_ACTIONS } from "../src/notifications/messages";
import { BrevoEmailSender, BrevoSmsSender, maskPhone, SimulatedEmailSender, SimulatedSmsSender } from "../src/notifications/senders";
import { withMyBooking } from "../src/events/bookings";
import type { AppClient } from "../src/supabase/supabase.service";
import { documentLink } from "../src/verifications/document-link";
import { toHttpError } from "../src/supabase/db-errors";

const SUPABASE_URL = "https://projet-fictif.supabase.co";

function configOf(values: Partial<Env>): ConfigService<Env, true> {
  const env = { ...validateEnv({}), ...values };
  return { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;
}

describe("Configuration (phase 2)", () => {
  it("interdit les adaptateurs simulés et l'absence des clés Supabase en production", () => {
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(/SMS_PROVIDER.*EMAIL_PROVIDER.*PAYMENT_PROVIDER/);
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(/SEND_SMS_HOOK_SECRET/);
  });

  it("exige la clé et l'expéditeur Brevo, et limite l'expéditeur SMS à 11 caractères", () => {
    expect(() => validateEnv({ SMS_PROVIDER: "brevo" })).toThrow(/BREVO_SMS_SENDER/);
    expect(() => validateEnv({ SMS_PROVIDER: "brevo", BREVO_API_KEY: "k", BREVO_SMS_SENDER: "WanyiyiCotonou" })).toThrow(/11/);
    expect(validateEnv({ SMS_PROVIDER: "brevo", BREVO_API_KEY: "k", BREVO_SMS_SENDER: "Wanyiyi" }).SMS_PROVIDER).toBe("brevo");
  });

  it("refuse FedaPay tant que la clé manque", () => {
    expect(() => validateEnv({ PAYMENT_PROVIDER: "fedapay" })).toThrow(/FEDAPAY_SECRET_KEY/);
  });
});

describe("Textes des codes et e-mails", () => {
  it("le SMS contient le code dans les trois langues, sans tiret long", () => {
    for (const locale of ["fr", "en", "yo"] as const) {
      const text = otpSms(locale, "482913");
      expect(text).toContain("482913");
      expect(text).not.toMatch(/[—–]|--/);
    }
  });

  it("chaque e-mail existe dans les trois langues, échappe le HTML et ne contient aucune couleur dorée", () => {
    for (const locale of ["fr", "en", "yo"] as const) {
      for (const action of SUPPORTED_EMAIL_ACTIONS) {
        const mail = authEmail(locale, action, "https://exemple.bj/?a=1&b=<x>", "123456");
        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.html).toContain("&lt;x&gt;");
        expect(mail.html).not.toContain("<x>");
        expect(mail.html).toContain("123456");
        expect(`${mail.subject} ${mail.text}`).not.toMatch(/[—–]|--/);
        expect(mail.html.toLowerCase()).not.toContain("c8a97e");
      }
    }
  });

  it("le lien de confirmation suit le format documenté par Supabase", () => {
    const link = new URL(confirmationLink(SUPABASE_URL, "hash123", "signup", "https://wanyiyi.bj/bienvenue"));
    expect(link.origin + link.pathname).toBe(`${SUPABASE_URL}/auth/v1/verify`);
    expect(Object.fromEntries(link.searchParams)).toEqual({ token: "hash123", type: "signup", redirect_to: "https://wanyiyi.bj/bienvenue" });
  });
});

describe("Envoi par Brevo (appel simulé)", () => {
  it("SMS : POST /v3/transactionalSMS/send avec la clé, l'expéditeur et le texte en Unicode", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: 1 }), { status: 201 }));
    await new BrevoSmsSender("cle-test", "Wanyiyi", fetchMock as unknown as typeof fetch).send("+2290197000001", "Votre code : 1", "otp");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/transactionalSMS/send");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("cle-test");
    expect(JSON.parse(init.body as string)).toEqual({
      sender: "Wanyiyi",
      recipient: "2290197000001",
      content: "Votre code : 1",
      type: "transactional",
      tag: "otp",
      unicodeEnabled: true,
    });
  });

  it("e-mail : POST /v3/smtp/email ; une erreur Brevo remonte avec son statut", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 400 }));
    const sender = new BrevoEmailSender("cle-test", "bonjour@exemple.bj", "Wanyiyi", fetchMock as unknown as typeof fetch);
    await expect(sender.send({ to: "a@b.bj", subject: "s", html: "<p>h</p>", text: "t", tag: "auth-signup" })).rejects.toMatchObject({ status: 400 });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("les numéros sont masqués dans le journal", () => {
    expect(maskPhone("+2290197123456")).toBe("*********3456");
  });
});

describe("Auth Hooks Supabase (signature)", () => {
  const secret = randomBytes(24).toString("base64");
  const config = configOf({ SUPABASE_URL, SEND_SMS_HOOK_SECRET: `v1,whsec_${secret}`, SEND_EMAIL_HOOK_SECRET: `v1,whsec_${secret}` });

  function signed(payload: unknown) {
    const body = JSON.stringify(payload);
    const id = "msg_test";
    const timestamp = new Date();
    const signature = new Webhook(secret).sign(id, timestamp, body);
    return {
      body,
      headers: { "webhook-id": id, "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)), "webhook-signature": signature },
    };
  }

  it("envoie le code OTP dans la langue du membre quand la signature est valide", async () => {
    const sms = new SimulatedSmsSender();
    const service = new AuthHooksService(config, sms, new SimulatedEmailSender());
    const { body, headers } = signed({ user: { id: "u1", phone: "22901970000", user_metadata: { locale: "en" } }, sms: { otp: "654321" } });
    await service.sendSms(body, headers);
    expect(sms.sent).toEqual([{ to: "+22901970000", text: otpSms("en", "654321"), tag: "otp" }]);
  });

  it("refuse une signature invalide ou un contenu modifié", async () => {
    const service = new AuthHooksService(config, new SimulatedSmsSender(), new SimulatedEmailSender());
    const { body, headers } = signed({ user: { id: "u1", phone: "22901970000" }, sms: { otp: "654321" } });
    await expect(service.sendSms(body.replace("654321", "000000"), headers)).rejects.toThrow(/invalid_signature/);
  });

  it("envoie l'e-mail de confirmation avec le lien documenté ; refuse un type non pris en charge", async () => {
    const email = new SimulatedEmailSender();
    const service = new AuthHooksService(config, new SimulatedSmsSender(), email);
    const data = { token: "112233", token_hash: "th", redirect_to: "https://wanyiyi.bj/ok", site_url: "https://wanyiyi.bj", token_new: "", token_hash_new: "" };
    const ok = signed({ user: { id: "u1", email: "afiwa@exemple.bj" }, email_data: { ...data, email_action_type: "signup" } });
    await service.sendEmail(ok.body, ok.headers);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe("afiwa@exemple.bj");
    expect(email.sent[0]!.text).toContain(confirmationLink(SUPABASE_URL, "th", "signup", "https://wanyiyi.bj/ok"));

    const ko = signed({ user: { id: "u1", email: "afiwa@exemple.bj" }, email_data: { ...data, email_action_type: "invite" } });
    await expect(service.sendEmail(ko.body, ko.headers)).rejects.toThrow(/unsupported_email_action/);
  });
});

describe("Jeton du membre (MemberGuard)", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" }] });

  class TestGuard extends MemberGuard {
    protected override keys(): JWTVerifyGetKey {
      return jwks;
    }
  }
  const guard = new TestGuard(configOf({ SUPABASE_URL }));

  const token = (claims: { aud?: string; exp?: string; iss?: string }) =>
    new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setSubject("11111111-1111-1111-1111-111111111111")
      .setIssuer(claims.iss ?? `${SUPABASE_URL}/auth/v1`)
      .setAudience(claims.aud ?? "authenticated")
      .setExpirationTime(claims.exp ?? "1h")
      .sign(privateKey);

  const contextWith = (authorization?: string) => {
    const request: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
    return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext };
  };

  it("accepte un jeton valide et expose l'identifiant du membre", async () => {
    const { request, context } = contextWith(`Bearer ${await token({})}`);
    expect(await guard.canActivate(context)).toBe(true);
    expect((request.member as { id: string }).id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("refuse l'absence de jeton, un mauvais émetteur, une mauvaise audience ou un jeton expiré", async () => {
    await expect(guard.canActivate(contextWith().context)).rejects.toThrow(/missing_token/);
    for (const claims of [{ iss: "https://autre.supabase.co/auth/v1" }, { aud: "anon" }, { exp: "-1m" }]) {
      await expect(guard.canActivate(contextWith(`Bearer ${await token(claims)}`).context)).rejects.toThrow(/invalid_token/);
    }
  });
});

describe("Erreurs de la base vers HTTP", () => {
  it("traduit les codes métier en statuts HTTP", () => {
    expect(toHttpError({ message: "not_validated" }).getStatus()).toBe(403);
    expect(toHttpError({ message: "already_registered" }).getStatus()).toBe(409);
    expect(toHttpError({ message: "forbidden_column" }).getResponse()).toMatchObject({ message: "forbidden_column" });
    expect(toHttpError({ message: "inconnu", code: "42501" }).getStatus()).toBe(403);
    expect(toHttpError({ message: "inconnu" }).getStatus()).toBe(500);
  });
});

describe("Soirées : situation du membre", () => {
  it("ajoute « mine » à la soirée concernée et null aux autres", () => {
    const booking = { event_id: "b", status: "waitlisted" as const, waitlist_rank: 2, confirm_by: "2026-10-20T18:00:00Z", paid: false };
    expect(withMyBooking([{ id: "a" }, { id: "b" }], [booking])).toEqual([
      { id: "a", mine: null },
      { id: "b", mine: { status: "waitlisted", waitlist_rank: 2, confirm_by: "2026-10-20T18:00:00Z", paid: false } },
    ]);
  });
});

describe("Lien signé vers une pièce d'identité", () => {
  /** Faux client « membre » : réponses de open_id_document et du paramètre de durée. */
  const memberClient = (rpc: { data: unknown; error: unknown }, setting: unknown) =>
    ({
      rpc: vi.fn(async () => rpc),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: setting, error: null }) }) }) }),
    }) as unknown as AppClient;
  const systemClient = (createSignedUrl: (path: string, seconds: number) => Promise<unknown>) =>
    ({ storage: { from: vi.fn(() => ({ createSignedUrl })) } }) as unknown as AppClient;

  it("ouvre la pièce par la base (journalisée), puis crée un lien de la durée paramétrée", async () => {
    const sign = vi.fn(async () => ({ data: { signedUrl: "https://stockage/lien" }, error: null }));
    const reasons: string[] = [];
    const member = memberClient({ data: "u1/abc.jpg", error: null }, { value: 300 });
    const result = await documentLink(member, (reason) => (reasons.push(reason), systemClient(sign)), "doc-1", "admin-1");
    expect(result).toEqual({ url: "https://stockage/lien", expiresIn: 300 });
    expect(member.rpc).toHaveBeenCalledWith("open_id_document", { p_document: "doc-1" });
    expect(sign).toHaveBeenCalledWith("u1/abc.jpg", 300);
    expect(reasons).toEqual([expect.stringContaining("admin-1")]);
  });

  it("refus de la base : aucun lien, aucune clé service role utilisée", async () => {
    const system = vi.fn();
    const member = memberClient({ data: null, error: { message: "forbidden", code: "42501" } }, { value: 300 });
    await expect(documentLink(member, system, "doc-1", "moderateur-1")).rejects.toMatchObject({ status: 403 });
    expect(system).not.toHaveBeenCalled();
  });

  it("sans durée valide en base, pas de lien (aucune valeur par défaut inventée)", async () => {
    const system = vi.fn();
    await expect(documentLink(memberClient({ data: "u1/a.jpg", error: null }, null), system, "doc-1", "admin-1")).rejects.toMatchObject({
      status: 503,
    });
    expect(system).not.toHaveBeenCalled();
  });
});
