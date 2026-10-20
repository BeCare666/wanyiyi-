/**
 * Client de l'API KkiaPay (question 7 réglée le 20 octobre 2026 : KkiaPay).
 * Mêmes adresses et en-têtes que le SDK serveur officiel @kkiapay-org/nodejs-sdk 1.0.7
 * (documentation : docs.kkiapay.me, « Node.js Admin SDK »), appelés directement :
 * - vérification : POST /api/v1/transactions/status  { transactionId }
 * - remboursement : POST /api/v1/transactions/revert  { transactionId }
 *   (seules les transactions Mobile Money réussies sont remboursables ; les frais ne le sont pas)
 * En-têtes : x-api-key (clé publique), x-private-key, x-secret-key.
 */

export const KKIAPAY_API = { sandbox: "https://api-sandbox.kkiapay.me", live: "https://api.kkiapay.me" } as const;

export type KkiapayKeys = { publicKey: string; privateKey: string; secret: string };

/** Champs utilisés de la réponse de vérification (exemple de la documentation officielle). */
export type KkiapayTransaction = {
  transactionId: string;
  status: string;
  amount: number;
  partnerId?: string | null;
  source?: string | null;
  failureCode?: string | null;
};

export class KkiapayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Délai maximal d'un appel : un réseau lent ne bloque pas la requête du membre indéfiniment. */
const TIMEOUT_MS = 20_000;

export class KkiapayClient {
  constructor(
    private readonly keys: KkiapayKeys,
    private readonly sandbox: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.sandbox ? KKIAPAY_API.sandbox : KKIAPAY_API.live}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.keys.publicKey,
        "x-private-key": this.keys.privateKey,
        "x-secret-key": this.keys.secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      // Le corps d'erreur ne contient pas de clé ; tronqué par prudence
      throw new KkiapayError(response.status, `KkiaPay ${path} : ${response.status} ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new KkiapayError(response.status, `KkiaPay ${path} : réponse illisible`);
    }
  }

  /** Détail d'une transaction, lu chez KkiaPay (jamais sur la seule parole du navigateur). */
  async verify(transactionId: string): Promise<KkiapayTransaction> {
    const data = (await this.post("/api/v1/transactions/status", { transactionId })) as Partial<KkiapayTransaction> | null;
    if (!data || typeof data.status !== "string" || typeof data.amount !== "number") {
      throw new KkiapayError(502, "KkiaPay : réponse de vérification incomplète");
    }
    return { ...data, transactionId: data.transactionId ?? transactionId } as KkiapayTransaction;
  }

  /** Remboursement intégral d'une transaction réussie. */
  async refund(transactionId: string): Promise<void> {
    await this.post("/api/v1/transactions/revert", { transactionId });
  }
}

/**
 * Une transaction vérifiée peut-elle payer ce paiement ? Réussie, du montant exact, et liée à ce
 * paiement (partnerId transmis au widget). Renvoie la raison du refus, ou null.
 */
export function rejectTransaction(transaction: KkiapayTransaction, payment: { id: string; amountXof: number }): string | null {
  if (transaction.status !== "SUCCESS") return "transaction_not_successful";
  if (transaction.amount !== payment.amountXof) return "amount_mismatch";
  if (transaction.partnerId !== payment.id) return "payment_mismatch";
  return null;
}
