import sharp from "sharp";

/**
 * Traitement des photos des membres (section 10.2 ; question 10 de la phase 3, choix du
 * 26 octobre 2026) avec la bibliothèque « sharp » :
 *   - au dépôt : JPEG, PNG ou WebP de 8 Mo au plus, tourné selon l'orientation de l'appareil,
 *     réduit à 1 600 pixels de côté, réenregistré en JPEG sans aucune métadonnée (lieu de prise
 *     de vue, appareil) ;
 *   - à chaque affichage : flou si le membre l'a choisi, filigrane généré par le serveur (nom et
 *     numéro de la personne qui regarde, date et heure de Cotonou), semi-transparent, à une
 *     position qui varie à chaque affichage.
 */

export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoRefusal = "photo_type" | "photo_too_large" | "photo_unreadable";

export function checkUpload(file: { mimetype: string; size: number } | undefined): PhotoRefusal | null {
  if (!file || !(PHOTO_MIME_TYPES as readonly string[]).includes(file.mimetype)) return "photo_type";
  if (file.size > PHOTO_MAX_BYTES) return "photo_too_large";
  return null;
}

/** Image déposée : orientée, réduite, en JPEG, sans métadonnées (sharp ne les recopie pas). */
export async function normalizePhoto(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new Error("photo_unreadable");
  }
}

const escapeXml = (text: string) => text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** Date et heure de Cotonou (UTC+1, sans heure d'été) : 26/10/2026 21:05. */
export function cotonouStamp(now: Date): string {
  const d = new Date(now.getTime() + 3_600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
}

/** Texte du filigrane : qui regarde, et quand. */
export function watermarkText(viewer: { firstName: string | null; lastName: string | null; number: string | null }, now: Date): string {
  const name = [viewer.firstName, viewer.lastName].filter(Boolean).join(" ") || "Ifedele";
  return [name, viewer.number, cotonouStamp(now)].filter(Boolean).join(" · ");
}

/**
 * Filigrane en SVG à la taille de l'image : le texte répété sur deux lignes en biais, à une
 * position tirée au hasard (random entre 0 et 1), semi-transparent, lisible sur fond clair ou foncé.
 */
export function watermarkSvg(text: string, width: number, height: number, random: () => number = Math.random): string {
  const size = Math.max(16, Math.round(Math.min(width, height) / 16));
  const x = Math.round(width * (0.05 + random() * 0.35));
  const y = Math.round(height * (0.2 + random() * 0.6));
  const angle = Math.round(-25 + random() * 15);
  const label = escapeXml(text);
  const line = (dy: number) =>
    // Remplissage par « style » : l'attribut fill seul n'est pas toujours appliqué par le moteur SVG
    `<text x="${x}" y="${y + dy}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="bold" style="fill:#ffffff;fill-opacity:0.5;stroke:#000000;stroke-opacity:0.3;stroke-width:1" transform="rotate(${angle} ${x} ${y})">${label}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${line(0)}${line(size * 4)}</svg>`;
}

/** Image affichée : flou éventuel puis filigrane, en JPEG. */
export async function renderForViewer(stored: Buffer, options: { blurred: boolean; watermark: string; random?: () => number }): Promise<Buffer> {
  const base = sharp(stored);
  const { width = PHOTO_MAX_SIDE, height = PHOTO_MAX_SIDE } = await base.metadata();
  const pipeline = options.blurred ? base.blur(Math.max(20, Math.round(Math.min(width, height) / 25))) : base;
  return pipeline
    .composite([{ input: Buffer.from(watermarkSvg(options.watermark, width, height, options.random)), top: 0, left: 0 }])
    .jpeg({ quality: 82 })
    .toBuffer();
}
