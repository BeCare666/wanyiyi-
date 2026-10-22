/**
 * Client de l'API FeexPay v2 (question 29 réglée le 22 octobre 2026 : FeexPay remplace KkiaPay).
 * Appelé uniquement par l'API : la clé ne va jamais dans le navigateur.
 * Documentation : docs.feexpay.me (version v2), sections « API - Payin », « Collecte par carte
 * bancaire », « Statut des payins », « Sandbox » et « Webhook » :
 * - Mobile Money (Bénin) : POST /api/transactions/public/requesttopay/{mtn|moov|celtiis_bj}
 *   { phoneNumber, amount, shop, description, callback_info } ;
 * - carte : POST /api/transactions/public/requesttopay/init (renvoie payment_url) ;
 * - statut : GET /api/transactions/public/single/status/{reference} (PENDING, SUCCESSFUL, FAILED).
 * En-tête : Authorization: Bearer <clé>. Le webhook n'est pas signé : le statut est toujours relu.
 * FeexPay n'a pas d'annulation de paiement : les remboursements se font à la main (décision du
 * 22 octobre 2026).
 */

export const FEEXPAY_API = { sandbox: "https://sandbox-api.feexpay.me", live: "https://api-v2.feexpay.me" } as const;

/** Réseaux Mobile Money du Bénin retenus, et leur adresse chez FeexPay. */
export const FEEXPAY_NETWORKS = { mtn: "mtn", moov: "moov", celtiis: "celtiis_bj" } as const;
export type FeexpayNetwork = keyof typeof FEEXPAY_NETWORKS;

export type FeexpayKeys = { apiKey: string; shop: string };

/** Champs utilisés des réponses FeexPay (exemples de la documentation). */
export type FeexpayTransaction = {
  reference: string;
  status: string;
  amount?: number | null;
  callback_info?: unknown;
  reason?: string | null;
};

export type FeexpayCardSession = { reference: string; paymentUrl: string };

/** Coordonnées exigées par FeexPay pour un paiement par carte (titulaire de la carte). */
export type CardHolder = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  city: string;
  zip: string;
};

export class FeexpayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Délai maximal d'un appel : un réseau lent ne bloque pas la requête du membre indéfiniment. */
const TIMEOUT_MS = 20_000;

/**
 * Numéro béninois au format attendu par FeexPay : 229, puis 01 et 8 chiffres
 * (numérotation à 10 chiffres). Espaces, tirets et « + » sont ignorés ; null si invalide.
 */
export function beninPhone(input: string): string | null {
  const digits = input.replace(/[\s.\-()+]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const national = digits.startsWith("229") ? digits.slice(3) : digits;
  return /^01\d{8}$/.test(national) ? `229${national}` : null;
}

export class FeexpayClient {
  constructor(
    private readonly keys: FeexpayKeys,
    private readonly sandbox: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.sandbox ? FEEXPAY_API.sandbox : FEEXPAY_API.live}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.keys.apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      // Le corps d'erreur ne contient pas la clé ; tronqué par prudence
      throw new FeexpayError(response.status, `FeexPay ${path} : ${response.status} ${text.slice(0, 200)}`);
    }
    try {
      const data: unknown = JSON.parse(text);
      if (data && typeof data === "object") return data as Record<string, unknown>;
    } catch {
      // réponse non JSON : traitée ci-dessous
    }
    throw new FeexpayError(502, `FeexPay ${path} : réponse illisible`);
  }

  private static transaction(data: Record<string, unknown>, path: string): FeexpayTransaction {
    if (typeof data.reference !== "string" || typeof data.status !== "string") {
      throw new FeexpayError(502, `FeexPay ${path} : réponse incomplète`);
    }
    return {
      reference: data.reference,
      status: data.status,
      amount: typeof data.amount === "number" ? data.amount : null,
      callback_info: data.callback_info,
      reason: typeof data.reason === "string" ? data.reason : null,
    };
  }

  /** Demande de paiement envoyée au téléphone du membre, qui la valide sur son téléphone. */
  async requestMobile(input: { network: FeexpayNetwork; phoneNumber: string; amountXof: number; description: string; paymentId: string }) {
    const path = `/api/transactions/public/requesttopay/${FEEXPAY_NETWORKS[input.network]}`;
    const data = await this.call("POST", path, {
      shop: this.keys.shop,
      amount: input.amountXof,
      phoneNumber: input.phoneNumber,
      description: input.description,
      callback_info: input.paymentId,
    });
    return FeexpayClient.transaction(data, path);
  }

  /** Session de paiement par carte : le membre paie sur la page FeexPay (payment_url). */
  async initCard(input: { holder: CardHolder; amountXof: number; description: string; paymentId: string; returnUrl: string }): Promise<FeexpayCardSession> {
    const path = "/api/transactions/public/requesttopay/init";
    const data = await this.call("POST", path, {
      shop: this.keys.shop,
      amount: String(input.amountXof),
      currency: "XOF",
      first_name: input.holder.firstName,
      last_name: input.holder.lastName,
      email: input.holder.email,
      phoneNumber: input.holder.phoneNumber,
      city: input.holder.city,
      zip: input.holder.zip,
      country: "BJ",
      description: input.description,
      callback_info: input.paymentId,
      return_url: input.returnUrl,
      cancel_url: input.returnUrl,
    });
    if (typeof data.reference !== "string" || typeof data.payment_url !== "string" || !data.payment_url.startsWith("https://")) {
      throw new FeexpayError(502, `FeexPay ${path} : réponse incomplète`);
    }
    return { reference: data.reference, paymentUrl: data.payment_url };
  }

  /** Statut d'une transaction, lu chez FeexPay (jamais sur la seule parole du navigateur ou du webhook). */
  async status(reference: string): Promise<FeexpayTransaction> {
    const path = `/api/transactions/public/single/status/${encodeURIComponent(reference)}`;
    return FeexpayClient.transaction(await this.call("GET", path), path);
  }
}

/** État d'une transaction FeexPay, vu par la plateforme. « IN PENDING STATE » vaut PENDING. */
export function outcomeOf(status: string): "succeeded" | "failed" | "pending" {
  if (status === "SUCCESSFUL") return "succeeded";
  if (status === "FAILED") return "failed";
  return "pending";
}

/**
 * Une transaction réussie peut-elle payer ce paiement ? Même référence, montant exact et, si
 * FeexPay le renvoie, identifiant du paiement (callback_info). Renvoie la raison du refus, ou null.
 */
export function rejectTransaction(transaction: FeexpayTransaction, payment: { id: string; amountXof: number; reference: string }): string | null {
  if (transaction.reference !== payment.reference) return "payment_mismatch";
  if (transaction.amount !== payment.amountXof) return "amount_mismatch";
  const info = transaction.callback_info;
  if (info !== null && info !== undefined && info !== "" && info !== payment.id) return "payment_mismatch";
  return null;
}
