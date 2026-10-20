import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { type Env, validateEnv } from "../src/config/env";
import { KKIAPAY_API, KkiapayClient, KkiapayError, type KkiapayTransaction, rejectTransaction } from "../src/payments/kkiapay";
import { KkiapayPaymentProvider, PaymentsService, SimulatedPaymentProvider } from "../src/payments/payments.service";
import type { SupabaseService } from "../src/supabase/supabase.service";

/** Adaptateur KkiaPay (question 7 réglée le 20 octobre 2026). Aucun appel réseau : fetch simulé. */

const keys = { publicKey: "pk_test", privateKey: "tpk_test", secret: "tsk_test" };

function configOf(values: Partial<Env>): ConfigService<Env, true> {
  const env = { ...validateEnv({}), ...values };
  return { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;
}

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

describe("Client KkiaPay (mêmes appels que le SDK officiel)", () => {
  it("vérification : adresse du bac à sable, trois clés en en-tête, référence dans le corps", async () => {
    const fetchImpl = fetchReturning(200, { transactionId: "tx1", status: "SUCCESS", amount: 5000, partnerId: "p1", source: "MOBILE_MONEY" });
    const transaction = await new KkiapayClient(keys, true, fetchImpl).verify("tx1");
    expect(transaction).toMatchObject({ transactionId: "tx1", status: "SUCCESS", amount: 5000, partnerId: "p1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${KKIAPAY_API.sandbox}/api/v1/transactions/status`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-api-key": "pk_test", "x-private-key": "tpk_test", "x-secret-key": "tsk_test" });
    expect(JSON.parse(init.body as string)).toEqual({ transactionId: "tx1" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("remboursement : adresse réelle hors bac à sable ; erreurs du prestataire remontées avec leur statut", async () => {
    const ok = fetchReturning(200, {});
    await new KkiapayClient(keys, false, ok).refund("tx9");
    expect((ok.mock.calls[0] as unknown as [string])[0]).toBe(`${KKIAPAY_API.live}/api/v1/transactions/revert`);

    const notFound = new KkiapayClient(keys, true, fetchReturning(404, "Transaction Not Found"));
    await expect(notFound.verify("x")).rejects.toMatchObject({ status: 404 });
    const gateway = new KkiapayClient(keys, true, fetchReturning(502, "<html>502 Bad Gateway</html>"));
    await expect(gateway.verify("x")).rejects.toBeInstanceOf(KkiapayError);
    const incomplete = new KkiapayClient(keys, true, fetchReturning(200, { status: "SUCCESS" }));
    await expect(incomplete.verify("x")).rejects.toThrow(/incomplète/);
  });

  it("transaction acceptée seulement si réussie, du montant exact et liée à ce paiement", () => {
    const payment = { id: "p1", amountXof: 5000 };
    const ok: KkiapayTransaction = { transactionId: "tx1", status: "SUCCESS", amount: 5000, partnerId: "p1" };
    expect(rejectTransaction(ok, payment)).toBeNull();
    expect(rejectTransaction({ ...ok, status: "FAILED" }, payment)).toBe("transaction_not_successful");
    expect(rejectTransaction({ ...ok, amount: 4000 }, payment)).toBe("amount_mismatch");
    expect(rejectTransaction({ ...ok, partnerId: "autre" }, payment)).toBe("payment_mismatch");
    expect(rejectTransaction({ ...ok, partnerId: null }, payment)).toBe("payment_mismatch");
  });
});

describe("Adaptateur de paiement KkiaPay", () => {
  it("page de paiement du site (widget) sans référence avant paiement ; remboursement par la référence", async () => {
    const client = { verify: vi.fn(), refund: vi.fn(async () => {}) } as unknown as KkiapayClient;
    const provider = new KkiapayPaymentProvider(client, "pk_test", true, "https://wanyiyi.example/");
    expect(await provider.createCheckout({ paymentId: "p1" })).toEqual({ providerTransactionId: null, checkoutUrl: "https://wanyiyi.example/paiement/p1" });
    await provider.refund({ providerTransactionId: "tx1" });
    expect(client.refund).toHaveBeenCalledWith("tx1");
    await expect(provider.refund({ providerTransactionId: null })).rejects.toThrow(/absente/);
  });
});

type Payment = { id: string; user_id: string; amount_xof: number; status: string; provider: string; provider_transaction_id: string | null; purpose?: string };

/** Base simulée : lecture du paiement, mise à jour conditionnelle, journal. */
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

function serviceWith(payment: Payment | null, verify: () => Promise<KkiapayTransaction>, update?: Parameters<typeof fakeSupabase>[1]) {
  const client = { verify: vi.fn(verify), refund: vi.fn() } as unknown as KkiapayClient;
  const provider = new KkiapayPaymentProvider(client, "pk_test", true, "https://w.example");
  const { supabase, writes } = fakeSupabase(payment, update);
  return { service: new PaymentsService(supabase, configOf({}), provider), writes, client };
}

const pending: Payment = { id: "p1", user_id: "m1", amount_xof: 5000, status: "pending", provider: "kkiapay", provider_transaction_id: null, purpose: "evening_booking" };
const success = async (): Promise<KkiapayTransaction> => ({ transactionId: "tx1", status: "SUCCESS", amount: 5000, partnerId: "p1", source: "MOBILE_MONEY" });

describe("Confirmation d'un paiement KkiaPay", () => {
  it("transaction vérifiée chez KkiaPay : paiement réussi, référence enregistrée, journalisé", async () => {
    const { service, writes, client } = serviceWith(pending, success);
    expect(await service.confirmKkiapay("m1", "p1", "tx1")).toEqual({ status: "succeeded" });
    expect(client.verify).toHaveBeenCalledWith("tx1");
    expect(writes[0]).toMatchObject({
      table: "payments",
      op: "update",
      values: { status: "succeeded", provider_transaction_id: "tx1" },
      filters: [
        ["id", "p1"],
        ["status", "pending"],
      ],
    });
    expect(writes[1]).toMatchObject({ table: "audit_log", op: "insert", values: { action: "payment.succeeded", target_id: "p1" } });
  });

  it("double envoi du navigateur : déjà réglé par la même transaction, sans nouvelle vérification", async () => {
    const { service, client } = serviceWith({ ...pending, status: "succeeded", provider_transaction_id: "tx1" }, success);
    expect(await service.confirmKkiapay("m1", "p1", "tx1")).toEqual({ status: "succeeded" });
    expect(client.verify).not.toHaveBeenCalled();
  });

  it("paiement d'un autre membre ou d'un autre prestataire : introuvable", async () => {
    await expect(serviceWith(pending, success).service.confirmKkiapay("autre", "p1", "tx1")).rejects.toMatchObject({ response: { message: "not_found" } });
    await expect(serviceWith({ ...pending, provider: "simulated" }, success).service.confirmKkiapay("m1", "p1", "tx1")).rejects.toMatchObject({ status: 404 });
  });

  it("montant ou paiement différent, transaction échouée : refusé, rien n'est écrit", async () => {
    const wrongAmount = serviceWith(pending, async () => ({ ...(await success()), amount: 100 }));
    await expect(wrongAmount.service.confirmKkiapay("m1", "p1", "tx1")).rejects.toMatchObject({ response: { message: "amount_mismatch" } });
    expect(wrongAmount.writes).toEqual([]);
    const otherPayment = serviceWith(pending, async () => ({ ...(await success()), partnerId: "p2" }));
    await expect(otherPayment.service.confirmKkiapay("m1", "p1", "tx1")).rejects.toMatchObject({ response: { message: "payment_mismatch" } });
  });

  it("transaction déjà utilisée pour un autre paiement : refusée par la référence unique", async () => {
    const { service } = serviceWith(pending, success, { data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(service.confirmKkiapay("m1", "p1", "tx1")).rejects.toMatchObject({ status: 409, response: { message: "transaction_already_used" } });
  });

  it("KkiaPay : transaction inconnue (409) ou prestataire injoignable (503)", async () => {
    const unknown = serviceWith(pending, async () => Promise.reject(new KkiapayError(404, "Transaction Not Found")));
    await expect(unknown.service.confirmKkiapay("m1", "p1", "tx1")).rejects.toMatchObject({ status: 409, response: { message: "transaction_not_found" } });
    const down = serviceWith(pending, async () => Promise.reject(new KkiapayError(502, "Bad Gateway")));
    await expect(down.service.confirmKkiapay("m1", "p1", "tx1")).rejects.toMatchObject({ status: 503 });
    // Clé refusée (réponse réelle de l'API : 401, {"status":4003,"reason":"Invalid API KEY"}) : panne de configuration
    const badKey = serviceWith(pending, async () => Promise.reject(new KkiapayError(401, "Invalid API KEY")));
    await expect(badKey.service.confirmKkiapay("m1", "p1", "tx1")).rejects.toMatchObject({ status: 503, response: { message: "kkiapay_unavailable" } });
  });

  it("adaptateur simulé configuré : confirmation KkiaPay refusée", async () => {
    const { supabase } = fakeSupabase(pending);
    const service = new PaymentsService(supabase, configOf({}), new SimulatedPaymentProvider("https://w.example"));
    await expect(service.confirmKkiapay("m1", "p1", "tx1")).rejects.toMatchObject({ status: 403 });
  });

  it("page de paiement : réglages publics du widget pour un paiement KkiaPay du membre", async () => {
    const { service } = serviceWith(pending, success);
    expect(await service.checkoutInfo("m1", "p1")).toEqual({
      paymentId: "p1",
      purpose: "evening_booking",
      amountXof: 5000,
      status: "pending",
      provider: "kkiapay",
      widget: { publicKey: "pk_test", sandbox: true },
    });
    await expect(service.checkoutInfo("autre", "p1")).rejects.toMatchObject({ status: 404 });
  });
});
