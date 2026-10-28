import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CloudinaryClient, cloudinarySignature, PROVIDERS_FOLDER } from "../src/providers/cloudinary";

/** Images des prestataires sur Cloudinary (phase 4, question 2 c). */

describe("Signature Cloudinary", () => {
  it("paramètres triés par nom, joints par &, suivis du secret, SHA-1", () => {
    // Exemple de la documentation Cloudinary (« Generating authentication signatures »)
    const expected = createHash("sha1").update("eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510abcd").digest("hex");
    expect(cloudinarySignature({ timestamp: 1315060510, public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" }, "abcd")).toBe(expected);
  });
});

describe("Client Cloudinary", () => {
  const keys = { cloudName: "demo", apiKey: "123", apiSecret: "secret" };

  it("envoi signé dans le dossier des prestataires ; adresse https renvoyée", async () => {
    let sent: { url: string; form: FormData } | null = null;
    const fetcher = (async (url: string, init: { body: FormData }) => {
      sent = { url, form: init.body };
      return new Response(JSON.stringify({ public_id: `${PROVIDERS_FOLDER}/abc`, secure_url: "https://res.cloudinary.com/demo/image/upload/abc.jpg" }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new CloudinaryClient(keys, fetcher, () => 1_700_000_000_000);
    const image = await client.upload(Buffer.from([1, 2, 3]));
    expect(image).toEqual({ publicId: `${PROVIDERS_FOLDER}/abc`, url: "https://res.cloudinary.com/demo/image/upload/abc.jpg" });
    expect(sent!.url).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(sent!.form.get("api_key")).toBe("123");
    expect(sent!.form.get("folder")).toBe(PROVIDERS_FOLDER);
    expect(sent!.form.get("signature")).toBe(cloudinarySignature({ folder: PROVIDERS_FOLDER, timestamp: 1_700_000_000 }, "secret"));
    expect(sent!.form.get("api_secret")).toBeNull();
  });

  it("refus de Cloudinary : erreur", async () => {
    const fetcher = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(new CloudinaryClient(keys, fetcher).upload(Buffer.from([1]))).rejects.toThrow(/401/);
  });
});
