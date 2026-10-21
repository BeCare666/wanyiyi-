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
import { BrevoEmailSender, BrevoSmsSender, DisabledSmsSender, maskPhone, SimulatedEmailSender, SimulatedSmsSender } from "../src/notifications/senders";
import { withMyBooking } from "../src/events/bookings";
import { DeliveriesService } from "../src/notifications/deliveries.service";
import { deliveryContent, siteUrl } from "../src/notifications/team-messages";
import { PaymentsService } from "../src/payments/payments.service";
import type { SupabaseService } from "../src/supabase/supabase.service";
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
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(/EMAIL_PROVIDER.*PAYMENT_PROVIDER/);
    expect(() => validateEnv({ NODE_ENV: "production", SMS_PROVIDER: "simulated" })).toThrow(/SMS_PROVIDER/);
    // Canal SMS coupé (20 octobre 2026) : « disabled » par défaut, accepté en production
    expect(validateEnv({}).SMS_PROVIDER).toBe("disabled");
    expect(() => validateEnv({ NODE_ENV: "production" })).not.toThrow(/SMS_PROVIDER/);
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(/SEND_EMAIL_HOOK_SECRET/);
  });

  it("canal SMS coupé : aucun envoi", async () => {
    await expect(new DisabledSmsSender().send()).rejects.toThrow(/sms_disabled/);
  });

  it("exige la clé et l'expéditeur Brevo, et limite l'expéditeur SMS à 11 caractères", () => {
    expect(() => validateEnv({ SMS_PROVIDER: "brevo" })).toThrow(/BREVO_SMS_SENDER/);
    expect(() => validateEnv({ SMS_PROVIDER: "brevo", BREVO_API_KEY: "k", BREVO_SMS_SENDER: "IfedeleCotonou" })).toThrow(/11/);
    expect(validateEnv({ SMS_PROVIDER: "brevo", BREVO_API_KEY: "k", BREVO_SMS_SENDER: "Ifedele" }).SMS_PROVIDER).toBe("brevo");
  });

  it("refuse KkiaPay tant que les clés manquent", () => {
    expect(() => validateEnv({ PAYMENT_PROVIDER: "kkiapay" })).toThrow(/KKIAPAY_PUBLIC_KEY/);
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
        // Code affiché seulement pour les e-mails à code ; les autres se confirment par le lien
        expect(mail.html.includes("123456")).toBe(action === "email" || action === "reauthentication");
        expect(`${mail.subject} ${mail.text}`).not.toMatch(/[—–]|--/);
        expect(mail.html.toLowerCase()).not.toContain("c8a97e");
      }
    }
  });

  it("le lien mène à la page /confirmation du site, dans la langue du membre (vérification token_hash)", () => {
    const link = new URL(confirmationLink("https://wanyiyi.bj/", "fr", "hash123", "signup"));
    expect(link.origin + link.pathname).toBe("https://wanyiyi.bj/confirmation");
    expect(Object.fromEntries(link.searchParams)).toEqual({ token_hash: "hash123", type: "signup" });
    expect(new URL(confirmationLink("https://wanyiyi.bj", "en", "h", "recovery")).pathname).toBe("/en/confirmation");
    expect(confirmationLink("https://wanyiyi.bj", "yo", "h", "reauthentication")).toBe("https://wanyiyi.bj/yo/");
  });
});

describe("Envoi par Brevo (appel simulé)", () => {
  it("SMS : POST /v3/transactionalSMS/send avec la clé, l'expéditeur et le texte en Unicode", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: 1 }), { status: 201 }));
    await new BrevoSmsSender("cle-test", "Ifedele", fetchMock as unknown as typeof fetch).send("+2290197000001", "Votre code : 1", "otp");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/transactionalSMS/send");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("cle-test");
    expect(JSON.parse(init.body as string)).toEqual({
      sender: "Ifedele",
      recipient: "2290197000001",
      content: "Votre code : 1",
      type: "transactional",
      tag: "otp",
      unicodeEnabled: true,
    });
  });

  it("e-mail : POST /v3/smtp/email ; une erreur Brevo remonte avec son statut", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 400 }));
    const sender = new BrevoEmailSender("cle-test", "bonjour@exemple.bj", "Ifedele", fetchMock as unknown as typeof fetch);
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
    // Lien vers WEB_ORIGIN de la configuration, jamais vers redirect_to reçu dans la requête
    expect(email.sent[0]!.text).toContain(confirmationLink("http://localhost:3000", "fr", "th", "signup"));
    expect(email.sent[0]!.text).not.toContain("wanyiyi.bj/ok");

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

describe("Remboursement des soirées annulées (19 octobre 2026)", () => {
  type Pending = { payment_id: string; amount_xof: number; provider: string; provider_transaction_id: string | null };

  function setup(pending: Pending[], refund: (input: { paymentId: string; amountXof: number }) => Promise<void>) {
    const calls: Array<[string, unknown]> = [];
    const db = {
      rpc: vi.fn(async (fn: string, args?: unknown) => {
        calls.push([fn, args]);
        return { data: fn === "pending_refunds" ? pending : null, error: null };
      }),
    };
    const supabase = { system: () => db } as unknown as SupabaseService;
    const provider = { name: "simulated" as const, createCheckout: vi.fn(), refund: vi.fn(refund) };
    return { service: new PaymentsService(supabase, configOf({}), provider), calls, provider };
  }

  it("montant intégral par l'adaptateur, puis marqué dans la base ; l'autre prestataire attend son adaptateur", async () => {
    const { service, calls, provider } = setup(
      [
        { payment_id: "p1", amount_xof: 5000, provider: "simulated", provider_transaction_id: "sim_p1" },
        { payment_id: "p2", amount_xof: 5000, provider: "fedapay", provider_transaction_id: "fp_2" },
      ],
      async () => {},
    );
    expect(await service.refundPending()).toEqual({ refunded: 1, failed: 1 });
    expect(provider.refund).toHaveBeenCalledWith({ paymentId: "p1", providerTransactionId: "sim_p1", amountXof: 5000 });
    expect(calls).toEqual([
      ["pending_refunds", undefined],
      ["mark_refunded", { p_payment: "p1" }],
    ]);
  });

  it("échec du prestataire : rien n'est marqué, la tâche planifiée relancera", async () => {
    const { service, calls } = setup([{ payment_id: "p1", amount_xof: 5000, provider: "simulated", provider_transaction_id: null }], async () => {
      throw new Error("prestataire injoignable");
    });
    expect(await service.refundPending()).toEqual({ refunded: 0, failed: 1 });
    expect(calls.map(([fn]) => fn)).toEqual(["pending_refunds"]);
  });

  it("codes d'erreur des soirées et des membres traduits en réponses HTTP", () => {
    expect(toHttpError({ message: "not_editable" }).getStatus()).toBe(409);
    expect(toHttpError({ message: "member_inactive" }).getStatus()).toBe(403);
  });
});

describe("Envois des actions groupées (19 octobre 2026)", () => {
  const body = { fr: "La soirée de vendredi est maintenue.", en: "Friday's evening is going ahead.", yo: "Ìpàdé ọjọ́ Ẹtì ṣì ń lọ." };

  it("message de l'équipe dans la langue du membre ; lien vers son espace, préfixe de langue hors français", () => {
    const fr = deliveryContent("team.message", { body }, "fr", "https://wanyiyi.example/")!;
    expect(fr.sms).toBe("Ifedele : La soirée de vendredi est maintenue.");
    expect(fr.email.text).toContain("https://wanyiyi.example/espace/notifications");
    const yo = deliveryContent("team.message", { body }, "yo", "https://wanyiyi.example")!;
    expect(yo.sms).toContain("Ìpàdé ọjọ́ Ẹtì");
    expect(yo.email.html).toContain('href="https://wanyiyi.example/yo/espace/notifications"');
    expect(deliveryContent("team.message", { body: { fr: "Seulement en français" } }, "en", "https://w.example")!.sms).toBe("Ifedele : Seulement en français");
  });

  it("le texte de l'équipe est échappé dans l'e-mail", () => {
    const html = deliveryContent("team.message", { body: { ...body, fr: "<script>x</script>" } }, "fr", "https://w.example")!.email.html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("invitation : date à l'heure de Cotonou dans la langue du membre, lien vers les soirées ; type inconnu sans envoi", () => {
    const invitation = deliveryContent("evening.invitation", { starts_at: "2026-10-23T19:00:00Z" }, "fr", "https://w.example")!;
    expect(invitation.sms).toMatch(/vendredi 23 octobre.*20:00/);
    expect(invitation.sms).toContain("https://w.example/espace/soirees");
    expect(deliveryContent("evening.invitation", { starts_at: "2026-10-23T19:00:00Z" }, "en", "https://w.example")!.sms).toContain("https://w.example/en/espace/soirees");
    expect(deliveryContent("evening.invitation", {}, "fr", "https://w.example")).toBeNull();
    expect(deliveryContent("autre.type", {}, "fr", "https://w.example")).toBeNull();
    expect(siteUrl("https://w.example/", "fr", "/espace")).toBe("https://w.example/espace");
  });

  it("file : envoyé, sans destinataire abandonné sans appel, échec du prestataire signalé pour relance", async () => {
    const calls: Array<[string, unknown]> = [];
    const pending = [
      { delivery_id: "d1", channel: "sms", kind: "team.message", payload: { body }, locale: "en", phone: "+22901970000001", email: null },
      { delivery_id: "d2", channel: "email", kind: "team.message", payload: { body }, locale: "fr", phone: "+22901970000001", email: null },
      { delivery_id: "d3", channel: "email", kind: "evening.invitation", payload: { starts_at: "2026-10-23T19:00:00Z" }, locale: "yo", phone: null, email: "ayaba@example.com" },
    ];
    const db = {
      rpc: vi.fn(async (fn: string, args?: unknown) => {
        calls.push([fn, args]);
        return { data: fn === "pending_deliveries" ? pending : null, error: null };
      }),
    };
    const supabase = { system: () => db } as unknown as SupabaseService;
    const sms = new SimulatedSmsSender();
    const email = { send: vi.fn(async () => Promise.reject(new Error("Brevo 503"))) };
    const service = new DeliveriesService(supabase, configOf({ WEB_ORIGIN: "https://w.example" }), sms, email);
    expect(await service.dispatch()).toEqual({ sent: 1, failed: 1, skipped: 1 });
    expect(sms.sent).toEqual([{ to: "+22901970000001", text: "Ifedele : Friday's evening is going ahead.", tag: "team.message" }]);
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: "ayaba@example.com", tag: "evening.invitation" }));
    expect(calls.slice(1)).toEqual([
      ["mark_delivery", { p_delivery: "d1", p_ok: true }],
      ["mark_delivery", { p_delivery: "d2", p_ok: false, p_error: "aucune adresse e-mail confirmée", p_skip: true }],
      ["mark_delivery", { p_delivery: "d3", p_ok: false, p_error: "Brevo 503" }],
    ]);
  });
});
