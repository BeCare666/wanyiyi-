import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { type Env, validateEnv } from "../src/config/env";
import { feexpayDescription, PaymentsService, SimulatedPaymentProvider } from "../src/payments/payments.service";
import { toHttpError } from "../src/supabase/db-errors";
import type { SupabaseService } from "../src/supabase/supabase.service";

/** Message payant au conseiller (demande seule, 10 novembre 2026). Base simulée, aucun appel réseau. */

const config = { get: (key: keyof Env) => validateEnv({})[key] } as unknown as ConfigService<Env, true>;

function serviceWith(rpcResult: { data: unknown; error: { message: string } | null }) {
  const writes: Array<{ table: string; op: string; values: unknown; filter?: [string, unknown] }> = [];
  const rpc = vi.fn(async () => rpcResult);
  const system = {
    from: (table: string) => ({
      insert: (values: unknown) => {
        writes.push({ table, op: "insert", values });
        return { select: () => ({ single: async () => ({ data: { id: "pay1" }, error: null }) }) };
      },
      update: (values: unknown) => ({
        eq: async (column: string, value: unknown) => {
          writes.push({ table, op: "update", values, filter: [column, value] });
          return { data: null, error: null };
        },
      }),
    }),
  };
  const supabase = { forMember: vi.fn(() => ({ rpc })), system: vi.fn(() => system) } as unknown as SupabaseService;
  return { service: new PaymentsService(supabase, config, new SimulatedPaymentProvider("https://w.example")), writes, rpc };
}

describe("Message payant au conseiller", () => {
  it("prépare le message avec le jeton du membre, crée le paiement au prix de la base et le rattache", async () => {
    const { service, writes, rpc } = serviceWith({ data: [{ pending_id: "pm1", price_xof: 200 }], error: null });
    expect(await service.startCounselMessagePayment("m1", "jeton", "c1", "Bonjour")).toEqual({
      paymentId: "pay1",
      checkoutUrl: "https://w.example/paiement-simule/pay1",
    });
    expect(rpc).toHaveBeenCalledWith("prepare_counsel_message", { p_conversation: "c1", p_body: "Bonjour" });
    expect(writes[0]).toEqual({ table: "payments", op: "insert", values: { user_id: "m1", purpose: "counsel_message", amount_xof: 200, provider: "simulated" } });
    expect(writes[1]).toEqual({ table: "counsel_pending_messages", op: "update", values: { payment_id: "pay1" }, filter: ["id", "pm1"] });
  });

  it("refus de la base renvoyé tel quel : rien à payer, discussion fermée, lien interdit", async () => {
    for (const [code, status] of [
      ["nothing_to_pay", 409],
      ["conversation_closed", 409],
      ["contact_blocked", 400],
      ["not_member", 403],
    ] as const) {
      const { service, writes } = serviceWith({ data: null, error: { message: code } });
      await expect(service.startCounselMessagePayment("m1", "jeton", "c1", "x")).rejects.toMatchObject({ status, response: { message: code } });
      expect(writes).toEqual([]);
    }
    expect(toHttpError({ message: "invalid_body" }).getStatus()).toBe(400);
  });

  it("libellé FeexPay court et sans accent", () => {
    expect(feexpayDescription("counsel_message")).toBe("Message conseiller ifedele");
  });
});
