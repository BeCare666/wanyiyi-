import { randomBytes } from "node:crypto";

/**
 * Liens d'affichage des photos (10.2) : l'image filigranée pour une personne est gardée en
 * mémoire derrière un jeton aléatoire, valable 5 minutes, jamais en accès public ni en cache.
 * Après redémarrage de l'API, les liens en cours ne marchent plus : le site en redemande un.
 */
export const PHOTO_LINK_SECONDS = 5 * 60;

type Entry = { image: Buffer; expiresAt: number };

export class PhotoLinks {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly clock: () => number = Date.now) {}

  create(image: Buffer): { token: string; expiresAt: Date } {
    this.sweep();
    const token = randomBytes(24).toString("base64url");
    const expiresAt = this.clock() + PHOTO_LINK_SECONDS * 1000;
    this.entries.set(token, { image, expiresAt });
    return { token, expiresAt: new Date(expiresAt) };
  }

  /** Image du jeton, ou null s'il est inconnu ou expiré. */
  get(token: string): Buffer | null {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(token);
      return null;
    }
    return entry.image;
  }

  private sweep() {
    const now = this.clock();
    for (const [token, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(token);
  }
}
