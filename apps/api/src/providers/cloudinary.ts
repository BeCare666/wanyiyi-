import { createHash } from "node:crypto";

/**
 * Envoi des images des prestataires sur Cloudinary (PROPOSITIONS.txt : contenus publics de la
 * vitrine seulement ; jamais de photo de membre ni de pièce d'identité). Appelé uniquement par
 * l'API : le secret ne va jamais dans le navigateur.
 * API REST « Upload » : POST https://api.cloudinary.com/v1_1/{cloud}/image/upload (file, api_key,
 * timestamp, folder, signature) et POST .../image/destroy (public_id, api_key, timestamp,
 * signature). Signature : paramètres signés triés par nom, « clé=valeur » joints par « & », suivis
 * du secret, empreinte SHA-1 en hexadécimal.
 */

export type CloudinaryKeys = { cloudName: string; apiKey: string; apiSecret: string };
export type CloudinaryImage = { publicId: string; url: string };

/** Dossier Cloudinary des images des prestataires. */
export const PROVIDERS_FOLDER = "ifedele/prestataires";

export function cloudinarySignature(params: Record<string, string | number>, apiSecret: string): string {
  const signed = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(signed + apiSecret).digest("hex");
}

export class CloudinaryClient {
  constructor(
    private readonly keys: CloudinaryKeys,
    private readonly fetcher: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  private endpoint(action: "upload" | "destroy") {
    return `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.keys.cloudName)}/image/${action}`;
  }

  private signedForm(params: Record<string, string | number>): FormData {
    const timestamp = Math.floor(this.clock() / 1000);
    const all = { ...params, timestamp };
    const form = new FormData();
    for (const [key, value] of Object.entries(all)) form.append(key, String(value));
    form.append("api_key", this.keys.apiKey);
    form.append("signature", cloudinarySignature(all, this.keys.apiSecret));
    return form;
  }

  /** Image JPEG déjà réduite et sans métadonnées ; renvoie son identifiant et son adresse https. */
  async upload(image: Buffer): Promise<CloudinaryImage> {
    const form = this.signedForm({ folder: PROVIDERS_FOLDER });
    form.append("file", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "image.jpg");
    const response = await this.fetcher(this.endpoint("upload"), { method: "POST", body: form });
    const body = (await response.json().catch(() => null)) as { public_id?: string; secure_url?: string } | null;
    if (!response.ok || !body?.public_id || !body.secure_url) throw new Error(`Cloudinary : envoi refusé (${response.status})`);
    return { publicId: body.public_id, url: body.secure_url };
  }

  /** Suppression d'une ancienne image (un échec n'empêche pas le remplacement). */
  async destroy(publicId: string): Promise<boolean> {
    const response = await this.fetcher(this.endpoint("destroy"), { method: "POST", body: this.signedForm({ public_id: publicId }) });
    return response.ok;
  }
}
