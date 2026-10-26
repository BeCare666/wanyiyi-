import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkUpload, cotonouStamp, normalizePhoto, PHOTO_MAX_BYTES, renderForViewer, watermarkSvg, watermarkText } from "../src/photos/photo-image";
import { PHOTO_LINK_SECONDS, PhotoLinks } from "../src/photos/photo-links";
import { feexpayDescription } from "../src/payments/payments.service";
import { toHttpError } from "../src/supabase/db-errors";

/** Photos des membres (10.2, question 10 de la phase 3) : dépôt, filigrane, liens de 5 minutes. */

/** Image de test avec des métadonnées EXIF (orientation et appareil fictif). */
async function sample(width: number, height: number, format: "jpeg" | "png" = "jpeg") {
  const img = sharp({ create: { width, height, channels: 3, background: "#3b5b7a" } }).withMetadata({
    orientation: 6,
    exif: { IFD0: { Make: "Appareil fictif", Model: "Test" } },
  });
  return format === "png" ? img.png().toBuffer() : img.jpeg().toBuffer();
}

describe("Dépôt d'une photo", () => {
  it("formats et taille contrôlés", () => {
    expect(checkUpload({ mimetype: "image/jpeg", size: 1000 })).toBeNull();
    expect(checkUpload({ mimetype: "image/webp", size: 1000 })).toBeNull();
    expect(checkUpload({ mimetype: "image/gif", size: 1000 })).toBe("photo_type");
    expect(checkUpload({ mimetype: "image/png", size: PHOTO_MAX_BYTES + 1 })).toBe("photo_too_large");
    expect(checkUpload(undefined)).toBe("photo_type");
  });

  it("réduite à 1 600 pixels, tournée selon l'appareil, en JPEG, sans aucune métadonnée", async () => {
    const out = await normalizePhoto(await sample(3200, 1800));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    // Orientation 6 : l'image est tournée d'un quart de tour avant la réduction
    expect([meta.width, meta.height]).toEqual([900, 1600]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("petite image gardée à sa taille ; PNG converti ; fichier illisible refusé", async () => {
    const out = await normalizePhoto(await sample(400, 300, "png"));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(400);
    await expect(normalizePhoto(Buffer.from("pas une image"))).rejects.toThrow("photo_unreadable");
  });
});

describe("Affichage filigrané", () => {
  const now = new Date("2026-10-26T20:05:00Z");

  it("texte : nom et numéro de la personne qui regarde, date et heure de Cotonou", () => {
    expect(cotonouStamp(now)).toBe("26/10/2026 21:05");
    expect(watermarkText({ firstName: "Koffi", lastName: "Fictif", number: "W-0042" }, now)).toBe("Koffi Fictif · W-0042 · 26/10/2026 21:05");
    expect(watermarkText({ firstName: null, lastName: null, number: null }, now)).toBe("Ifedele · 26/10/2026 21:05");
  });

  it("position variable d'un affichage à l'autre ; texte échappé", () => {
    const a = watermarkSvg("A <b> & 'c'", 800, 600, () => 0);
    const b = watermarkSvg("A <b> & 'c'", 800, 600, () => 0.99);
    expect(a).not.toBe(b);
    expect(a).toContain("A &lt;b&gt; &amp; &apos;c&apos;");
    expect(a).not.toContain("<b>");
  });

  it("image filigranée (pixels modifiés), floutée si demandé, en JPEG", async () => {
    const stored = await normalizePhoto(await sample(600, 400));
    const plain = await sharp(stored).raw().toBuffer();
    const marked = await renderForViewer(stored, { blurred: false, watermark: "Koffi · W-0042", random: () => 0.5 });
    expect((await sharp(marked).metadata()).format).toBe("jpeg");
    const markedRaw = await sharp(marked).raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < plain.length; i += 3) if (Math.abs(plain[i]! - markedRaw[i]!) > 30) changed += 1;
    expect(changed).toBeGreaterThan(100);
    const blurred = await renderForViewer(stored, { blurred: true, watermark: "Koffi", random: () => 0.5 });
    expect(blurred.length).toBeGreaterThan(0);
    // Premier rendu de texte : chargement des polices, lent sur ce poste
  }, 60_000);
});

describe("Liens de 5 minutes", () => {
  it("jeton aléatoire, valable 5 minutes, puis oublié", () => {
    let now = 0;
    const links = new PhotoLinks(() => now);
    const image = Buffer.from("image");
    const { token, expiresAt } = links.create(image);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(expiresAt.getTime()).toBe(PHOTO_LINK_SECONDS * 1000);
    expect(links.get(token)).toBe(image);
    expect(links.get("inconnu")).toBeNull();
    now = PHOTO_LINK_SECONDS * 1000 - 1;
    expect(links.get(token)).toBe(image);
    now = PHOTO_LINK_SECONDS * 1000;
    expect(links.get(token)).toBeNull();
    expect(links.create(image).token).not.toBe(token);
  });
});

describe("Codes d'erreur de la base (photos, accès au conseiller)", () => {
  it("traduits en réponses HTTP avec leur code", () => {
    expect(toHttpError({ message: "too_many_photos" }).getStatus()).toBe(409);
    expect(toHttpError({ message: "invalid_photo" }).getStatus()).toBe(400);
    expect(toHttpError({ message: "nothing_to_pay" }).getStatus()).toBe(409);
    expect(toHttpError({ message: "couple_blocked" }).getStatus()).toBe(403);
  });

  it("libellé FeexPay selon l'objet du paiement", () => {
    expect(feexpayDescription("counselor_access")).toBe("Conseiller ifedele");
    expect(feexpayDescription("evening_booking")).toBe("Soiree ifedele");
  });
});
