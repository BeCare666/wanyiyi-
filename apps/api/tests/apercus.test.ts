import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { previewPathOf, previewPhoto } from "../src/photos/photo-image";
import { createMissingPreviews } from "../src/photos/previews";
import type { AppClient } from "../src/supabase/supabase.service";

/** Aperçu des participants d'une soirée (29 octobre 2026) : copie très floutée de chaque photo. */

/** Image nette : damier noir et blanc (beaucoup de détails, que le flou doit effacer). */
async function checkerboard(size: number) {
  const cell = size / 16;
  const rects = Array.from({ length: 256 }, (_, i) => ((Math.floor(i / 16) + (i % 16)) % 2 === 0 ? `<rect x="${(i % 16) * cell}" y="${Math.floor(i / 16) * cell}" width="${cell}" height="${cell}"/>` : "")).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#fff"/>${rects}</svg>`)).jpeg().toBuffer();
}

describe("Copie d'aperçu", () => {
  it("réduite à 480 pixels, en JPEG, détails effacés par le flou", async () => {
    const preview = await previewPhoto(await checkerboard(1600));
    const meta = await sharp(preview).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(480);
    const { channels } = await sharp(preview).stats();
    // Damier net : écart-type proche de 127 ; très flouté : presque gris uniforme
    expect(channels[0]!.stdev).toBeLessThan(20);
  }, 30_000);

  it("chemin : même dossier que la photo, préfixe « apercu- »", () => {
    expect(previewPathOf("u1/abc.jpg")).toBe("u1/apercu-abc.jpg");
  });
});

describe("Copies manquantes (tâche système)", () => {
  it("lit la photo, dépose la copie floutée à côté, puis la marque ; un échec n'arrête pas le lot", async () => {
    const original = await checkerboard(800);
    const rpc = vi.fn(async (name: string) =>
      name === "photos_without_preview"
        ? { data: [{ photo_id: "p1", storage_path: "u1/a.jpg" }, { photo_id: "p2", storage_path: "u2/absent.jpg" }], error: null }
        : { data: null, error: null },
    );
    const download = vi.fn(async (path: string) =>
      path === "u1/a.jpg" ? { data: new Blob([new Uint8Array(original)]), error: null } : { data: null, error: { message: "Object not found" } },
    );
    const upload = vi.fn(async () => ({ data: {}, error: null }));
    const client = { rpc, storage: { from: vi.fn(() => ({ download, upload })) } } as unknown as AppClient;
    const log = { log: vi.fn(), error: vi.fn() };
    expect(await createMissingPreviews(client, log)).toBe(1);
    expect(upload).toHaveBeenCalledWith("u1/apercu-a.jpg", expect.any(Buffer), { contentType: "image/jpeg", upsert: true });
    expect(rpc).toHaveBeenCalledWith("mark_photo_preview", { p_photo: "p1", p_path: "u1/apercu-a.jpg" });
    expect(rpc).not.toHaveBeenCalledWith("mark_photo_preview", expect.objectContaining({ p_photo: "p2" }));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("p2"));
  }, 30_000);
});
