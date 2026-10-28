import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { type Env, validateEnv } from "../src/config/env";
import { beninPhone, FEEXPAY_API, FeexpayClient, FeexpayError, type FeexpayTransaction, outcomeOf, rejectTransaction } from "../src/payments/feexpay";
import { FeexpayPaymentProvider, PaymentsService, SimulatedPaymentProvider } from "../src/payments/payments.service";
import type { SupabaseService } from "../src/supabase/supabase.service";

/** Adaptateur FeexPay (question 29 réglée le 22 octobre 2026). Aucun appel réseau : fetch simulé. */

const keys = { apiKey: "test_key_abc", shop: "shop1" };

function configOf(values: Partial<Env>): ConfigService<Env, true> {
  const env = { ...validateEnv({}), ...values };
  return { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;
}

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

describe("Client FeexPay (API v2)", () => {
  it("Mobile Money : adresse du bac à sable par réseau, clé en Bearer, boutique et paiement dans le corps", async () => {
    const fetchImpl = fetchReturning(200, { reference: "ref1", message: "Accepted", status: "PENDING" });
    const client = new FeexpayClient(keys, true, fetchImpl);
    const transaction = await client.requestMobile({ network: "celtiis", phoneNumber: "2290197000005", amountXof: 10000, description: "Soiree ifedele", paymentId: "p1" });
    expect(transaction).toMatchObject({ reference: "ref1", status: "PENDING" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${FEEXPAY_API.sandbox}/api/transactions/public/requesttopay/celtiis_bj`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer test_key_abc" });
    expect(JSON.parse(init.body as string)).toEqual({
      shop: "shop1",
      amount: 10000,
      phoneNumber: "2290197000005",
      description: "Soiree ifedele",
      callback_info: "p1",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const live = fetchReturning(200, { reference: "r", status: "SUCCESSFUL" });
    await new FeexpayClient(keys, false, live).requestMobile({ network: "mtn", phoneNumber: "2290197000000", amountXof: 100, description: "x", paymentId: "p" });
    expect((live.mock.calls[0] as unknown as [string])[0]).toBe(`${FEEXPAY_API.live}/api/transactions/public/requesttopay/mtn`);
  });

  it("carte : page de paiement FeexPay, montant en texte, coordonnées du titulaire, retour vers le site", async () => {
    const fetchImpl = fetchReturning(200, { reference: "card1", status: "PENDING", payment_url: "https://checkout.feexpay.me/checkout/card-details?ref=card1" });
    const holder = { firstName: "Afiwa", lastName: "Houngbo", email: "afiwa@example.com", phoneNumber: "2290197000000", city: "Cotonou", zip: "00229" };
    const session = await new FeexpayClient(keys, true, fetchImpl).initCard({ holder, amountXof: 10000, description: "Soiree ifedele", paymentId: "p1", returnUrl: "https://w.example/paiement/p1" });
    expect(session).toEqual({ reference: "card1", paymentUrl: "https://checkout.feexpay.me/checkout/card-details?ref=card1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${FEEXPAY_API.sandbox}/api/transactions/public/requesttopay/init`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      shop: "shop1",
      amount: "10000",
      currency: "XOF",
      first_name: "Afiwa",
      last_name: "Houngbo",
      country: "BJ",
      callback_info: "p1",
      return_url: "https://w.example/paiement/p1",
    });
    const noUrl = new FeexpayClient(keys, true, fetchReturning(200, { reference: "c", status: "PENDING" }));
    await expect(noUrl.initCard({ holder, amountXof: 1, description: "x", paymentId: "p", returnUrl: "https://w" })).rejects.toThrow(/incomplète/);
  });

  it("statut : GET avec la référence ; erreurs du prestataire remontées avec leur statut", async () => {
    const fetchImpl = fetchReturning(200, { reference: "ref1", amount: 10000, status: "SUCCESSFUL", callback_info: "p1", reason: "" });
    expect(await new FeexpayClient(keys, true, fetchImpl).status("ref1")).toMatchObject({ reference: "ref1", amount: 10000, status: "SUCCESSFUL" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${FEEXPAY_API.sandbox}/api/transactions/public/single/status/ref1`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();

    await expect(new FeexpayClient(keys, true, fetchReturning(400, { code: "INVALID_SANDBOX_TEST_NUMBER" })).status("x")).rejects.toMatchObject({ status: 400 });
    await expect(new FeexpayClient(keys, true, fetchReturning(502, "<html>502</html>")).status("x")).rejects.toBeInstanceOf(FeexpayError);
    await expect(new FeexpayClient(keys, true, fetchReturning(200, "pas du JSON")).status("x")).rejects.toThrow(/illisible/);
    await expect(new FeexpayClient(keys, true, fetchReturning(200, { status: "SUCCESSFUL" })).status("x")).rejects.toThrow(/incomplète/);
  });

  it("numéro béninois à 10 chiffres (01 + 8 chiffres), avec ou sans indicatif 229", () => {
    expect(beninPhone("01 97 00 00 00")).toBe("2290197000000");
    expect(beninPhone("+229 01 97 00 00 00")).toBe("2290197000000");
    expect(beninPhone("2290197000000")).toBe("2290197000000");
    expect(beninPhone("97000000")).toBeNull();
    expect(beninPhone("0297000000")).toBeNull();
    expect(beninPhone("01970000ab")).toBeNull();
  });

  it("statuts et contrôle de la transaction : même référence, montant exact, même paiement", () => {
    expect(outcomeOf("SUCCESSFUL")).toBe("succeeded");
    expect(outcomeOf("FAILED")).toBe("failed");
    expect(outcomeOf("PENDING")).toBe("pending");
    expect(outcomeOf("IN PENDING STATE")).toBe("pending");
    const payment = { id: "p1", amountXof: 10000, reference: "ref1" };
    const ok: FeexpayTransaction = { reference: "ref1", status: "SUCCESSFUL", amount: 10000, callback_info: "p1" };
    expect(rejectTransaction(ok, payment)).toBeNull();
    expect(rejectTransaction({ ...ok, callback_info: null }, payment)).toBeNull();
    expect(rejectTransaction({ ...ok, reference: "autre" }, payment)).toBe("payment_mismatch");
    expect(rejectTransaction({ ...ok, amount: 100 }, payment)).toBe("amount_mismatch");
    expect(rejectTransaction({ ...ok, amount: null }, payment)).toBe("amount_mismatch");
    expect(rejectTransaction({ ...ok, callback_info: "p2" }, payment)).toBe("payment_mismatch");
  });
});

type Payment = { id: string; user_id: string | null; amount_xof: number; status: string; provider: string; provider_transaction_id: string | null; purpose?: string };

/** Base simulée : lecture du paiement, mises à jour conditionnelles, journal. */
function fakeSupabase(payment: Payment | null, update: { data: unknown; error: { code?: string; message?: string } | null } = { data: [{ id: "p1" }], error: null }) {
  const writes: Array<{ table: string; op: string; values: unknown; filters: Array<[string, unknown]> }> = [];
  const from = (table: string) => {
    const state = { table, op: "select", values: null as unknown, filters: [] as Array<[string, unknown]> };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        state.filters.push([column, value]);
        return builder;
      },
      update: (values: unknown) => {
        state.op = "update";
        state.values = values;
        return builder;
      },
      insert: async (values: unknown) => {
        writes.push({ ...state, op: "insert", values });
        return { data: null, error: null };
      },
      maybeSingle: async () => ({ data: payment, error: null }),
      then: (resolve: (value: unknown) => void) => {
        writes.push(state);
        resolve(update);
      },
    };
    return builder;
  };
  return { supabase: { system: () => ({ from }) } as unknown as SupabaseService, writes };
}

type Calls = { requestMobile?: () => Promise<FeexpayTransaction>; status?: () => Promise<FeexpayTransaction> };

function serviceWith(payment: Payment | null, calls: Calls, update?: Parameters<typeof fakeSupabase>[1]) {
  const client = {
    requestMobile: vi.fn(calls.requestMobile ?? (async () => ({ reference: "ref1", status: "PENDING" }))),
    initCard: vi.fn(async () => ({ reference: "card1", paymentUrl: "https://checkout.feexpay.me/checkout/card-details?ref=card1" })),
    status: vi.fn(calls.status ?? (async () => ({ reference: "ref1", status: "PENDING" }))),
  } as unknown as FeexpayClient;
  const provider = new FeexpayPaymentProvider(client, true, "https://w.example/");
  const { supabase, writes } = fakeSupabase(payment, update);
  return { service: new PaymentsService(supabase, configOf({}), provider), writes, client };
}

const pending: Payment = { id: "p1", user_id: "m1", amount_xof: 10000, status: "pending", provider: "feexpay", provider_transaction_id: null, purpose: "evening_booking" };
const successful = async (): Promise<FeexpayTransaction> => ({ reference: "ref1", status: "SUCCESSFUL", amount: 10000, callback_info: "p1" });

describe("Paiement d'une soirée par FeexPay", () => {
  it("page du site : adresse de paiement sans référence avant le choix du moyen ; pas de remboursement automatique", async () => {
    const provider = new FeexpayPaymentProvider({} as FeexpayClient, true, "https://w.example/");
    expect(await provider.createCheckout({ paymentId: "p1" })).toEqual({ providerTransactionId: null, checkoutUrl: "https://w.example/paiement/p1" });
    expect(provider.refund).toBeUndefined();
  });

  it("Mobile Money : demande envoyée au numéro normalisé, référence gardée, en attente de validation", async () => {
    const { service, writes, client } = serviceWith(pending, {});
    expect(await service.payByMobile("m1", "p1", "mtn", "01 97 00 00 05")).toEqual({ status: "pending" });
    expect(client.requestMobile).toHaveBeenCalledWith({ network: "mtn", phoneNumber: "2290197000005", amountXof: 10000, description: "Soiree ifedele", paymentId: "p1" });
    expect(writes).toEqual([
      {
        table: "payments",
        op: "update",
        values: { provider_transaction_id: "ref1" },
        filters: [
          ["id", "p1"],
          ["status", "pending"],
        ],
      },
    ]);
    expect(client.status).not.toHaveBeenCalled();
  });

  it("statut final immédiat : toujours relu par la route de statut, paiement réussi et journalisé", async () => {
    const { service, writes, client } = serviceWith(pending, { requestMobile: successful, status: successful });
    expect(await service.payByMobile("m1", "p1", "moov", "0197000000")).toEqual({ status: "succeeded" });
    expect(client.status).toHaveBeenCalledWith("ref1");
    expect(writes[1]).toMatchObject({
      table: "payments",
      op: "update",
      values: { status: "succeeded" },
      filters: [
        ["id", "p1"],
        ["status", "pending"],
        ["provider_transaction_id", "ref1"],
      ],
    });
    expect(writes[2]).toMatchObject({ table: "audit_log", op: "insert", values: { action: "payment.succeeded", target_id: "p1", details: { provider: "feexpay", reference: "ref1" } } });
  });

  it("échec chez FeexPay : le paiement reste à régler, le motif est renvoyé", async () => {
    const failed = async (): Promise<FeexpayTransaction> => ({ reference: "ref1", status: "FAILED", amount: 10000, reason: "LOW_BALANCE" });
    const { service, writes } = serviceWith(pending, { requestMobile: failed, status: failed });
    expect(await service.payByMobile("m1", "p1", "mtn", "0197000001")).toEqual({ status: "failed", reason: "LOW_BALANCE" });
    expect(writes.filter((w) => (w.values as { status?: string } | null)?.status)).toEqual([]);
  });

  it("une demande encore en attente bloque une seconde demande ; réussie, elle règle le paiement", async () => {
    const waiting = serviceWith({ ...pending, provider_transaction_id: "ref1" }, {});
    await expect(waiting.service.payByMobile("m1", "p1", "mtn", "0197000000")).rejects.toMatchObject({ status: 409, response: { message: "payment_in_progress" } });
    expect(waiting.client.requestMobile).not.toHaveBeenCalled();

    const paid = serviceWith({ ...pending, provider_transaction_id: "ref1" }, { status: successful });
    expect(await paid.service.payByCard("m1", "p1", { firstName: "A", lastName: "B", email: "a@b.example", phoneNumber: "0197000000", city: "Cotonou", zip: "00229" })).toEqual({
      status: "succeeded",
      paymentUrl: null,
    });
    expect(paid.client.initCard).not.toHaveBeenCalled();
  });

  it("carte : page FeexPay renvoyée, retour sur la page de paiement du site", async () => {
    const { service, client } = serviceWith(pending, {});
    const holder = { firstName: "Afiwa", lastName: "Houngbo", email: "afiwa@example.com", phoneNumber: "+229 01 97 00 00 00", city: "Cotonou", zip: "00229" };
    expect(await service.payByCard("m1", "p1", holder)).toEqual({ status: "pending", paymentUrl: "https://checkout.feexpay.me/checkout/card-details?ref=card1" });
    expect(client.initCard).toHaveBeenCalledWith({
      holder: { ...holder, phoneNumber: "2290197000000" },
      amountXof: 10000,
      description: "Soiree ifedele",
      paymentId: "p1",
      returnUrl: "https://w.example/paiement/p1",
    });
  });

  it("refus : numéro invalide, paiement d'un autre membre ou d'un autre prestataire, transaction non rattachable", async () => {
    await expect(serviceWith(pending, {}).service.payByMobile("m1", "p1", "mtn", "97000000")).rejects.toMatchObject({ response: { message: "invalid_phone" } });
    await expect(serviceWith(pending, {}).service.payByMobile("autre", "p1", "mtn", "0197000000")).rejects.toMatchObject({ status: 404 });
    await expect(serviceWith({ ...pending, provider: "simulated" }, {}).service.refreshFeexpay("m1", "p1")).rejects.toMatchObject({ status: 404 });
    const wrongAmount = serviceWith({ ...pending, provider_transaction_id: "ref1" }, { status: async () => ({ ...(await successful()), amount: 100 }) });
    await expect(wrongAmount.service.refreshFeexpay("m1", "p1")).rejects.toMatchObject({ response: { message: "amount_mismatch" } });
    expect(wrongAmount.writes).toEqual([]);
  });

  it("contribution à une cagnotte sans compte (phase 4) : seulement un paiement « contribution » sans membre", async () => {
    const contribution: Payment = { ...pending, user_id: null, purpose: "contribution" };
    const visitor = serviceWith(contribution, {});
    expect(await visitor.service.payByMobile(null, "p1", "mtn", "0197000005")).toEqual({ status: "pending" });
    expect(visitor.client.requestMobile).toHaveBeenCalledWith(expect.objectContaining({ description: "Cagnotte ifedele", amountXof: 10000 }));
    // Paiement d'un membre : jamais sans connexion ; contribution : jamais au nom d'un membre
    await expect(serviceWith(pending, {}).service.payByMobile(null, "p1", "mtn", "0197000005")).rejects.toMatchObject({ status: 404 });
    await expect(serviceWith(contribution, {}).service.payByMobile("m1", "p1", "mtn", "0197000005")).rejects.toMatchObject({ status: 404 });
    await expect(serviceWith({ ...contribution, user_id: "m1" }, {}).service.refreshFeexpay(null, "p1")).rejects.toMatchObject({ status: 404 });
    const info = await serviceWith(contribution, {}).service.contributionInfo("p1");
    expect(info).toMatchObject({ amountXof: 10000, status: "pending", networks: ["mtn", "moov", "celtiis"], awaiting: false });
  });

  it("FeexPay : demande refusée (409) ou prestataire injoignable, clé refusée (503)", async () => {
    const refused = serviceWith(pending, { requestMobile: async () => Promise.reject(new FeexpayError(400, "INVALID_PHONE_NUMBER")) });
    await expect(refused.service.payByMobile("m1", "p1", "mtn", "0197000004")).rejects.toMatchObject({ status: 409, response: { message: "payment_refused" } });
    const badKey = serviceWith(pending, { requestMobile: async () => Promise.reject(new FeexpayError(401, "UNAUTHORIZED")) });
    await expect(badKey.service.payByMobile("m1", "p1", "mtn", "0197000000")).rejects.toMatchObject({ status: 503, response: { message: "feexpay_unavailable" } });
  });

  it("vérification par le membre et webhook : statut relu chez FeexPay", async () => {
    const member = serviceWith({ ...pending, provider_transaction_id: "ref1" }, { status: successful });
    expect(await member.service.refreshFeexpay("m1", "p1")).toEqual({ status: "succeeded" });
    await expect(serviceWith(pending, {}).service.refreshFeexpay("m1", "p1")).rejects.toMatchObject({ response: { message: "invalid_status" } });

    const hook = serviceWith({ ...pending, provider_transaction_id: "ref1" }, { status: successful });
    await hook.service.feexpayWebhook("ref1");
    expect(hook.client.status).toHaveBeenCalledWith("ref1");
    expect(hook.writes.some((w) => w.table === "audit_log")).toBe(true);
    const settled = serviceWith({ ...pending, status: "succeeded", provider_transaction_id: "ref1" }, { status: successful });
    await settled.service.feexpayWebhook("ref1");
    expect(settled.client.status).not.toHaveBeenCalled();
  });

  it("page de paiement : moyens proposés et demande en attente ; adaptateur simulé : FeexPay refusé", async () => {
    expect(await serviceWith({ ...pending, provider_transaction_id: "ref1" }, {}).service.checkoutInfo("m1", "p1")).toEqual({
      paymentId: "p1",
      purpose: "evening_booking",
      amountXof: 10000,
      status: "pending",
      provider: "feexpay",
      feexpay: { sandbox: true, networks: ["mtn", "moov", "celtiis"], awaiting: true },
    });
    await expect(serviceWith(pending, {}).service.checkoutInfo("autre", "p1")).rejects.toMatchObject({ status: 404 });
    const { supabase } = fakeSupabase(pending);
    const simulated = new PaymentsService(supabase, configOf({}), new SimulatedPaymentProvider("https://w.example"));
    await expect(simulated.payByMobile("m1", "p1", "mtn", "0197000000")).rejects.toMatchObject({ status: 403 });
  });
});
