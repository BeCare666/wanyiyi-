import type { AppClient } from "../supabase/supabase.service";
import { previewPathOf, previewPhoto } from "./photo-image";

const BUCKET = "member-photos";
/** Photos traitées par passage : quelques secondes de calcul au plus. */
const BATCH = 20;

type Log = { log: (message: string) => void; error: (message: string) => void };

/**
 * Copies floutées des photos déposées avant les aperçus de soirée (29 octobre 2026), clé
 * service role (tâche système) : lecture de la photo, copie très floutée déposée à côté, puis
 * app.mark_photo_preview. Un échec est repris au passage suivant.
 */
export async function createMissingPreviews(db: AppClient, logger: Log): Promise<number> {
  const { data, error } = await db.rpc("photos_without_preview", { p_limit: BATCH });
  if (error) {
    logger.error(`Copies d'aperçu : ${error.message}`);
    return 0;
  }
  let done = 0;
  for (const { photo_id, storage_path } of (data ?? []) as { photo_id: string; storage_path: string }[]) {
    try {
      const file = await db.storage.from(BUCKET).download(storage_path);
      if (file.error || !file.data) throw new Error(`lecture : ${file.error?.message ?? "fichier absent"}`);
      const preview = await previewPhoto(Buffer.from(await file.data.arrayBuffer()));
      const path = previewPathOf(storage_path);
      const stored = await db.storage.from(BUCKET).upload(path, preview, { contentType: "image/jpeg", upsert: true });
      if (stored.error) throw new Error(`dépôt : ${stored.error.message}`);
      const { error: markError } = await db.rpc("mark_photo_preview", { p_photo: photo_id, p_path: path });
      if (markError) throw new Error(`marquage : ${markError.message}`);
      done += 1;
    } catch (e) {
      logger.error(`Photo ${photo_id} : ${(e as Error).message}`);
    }
  }
  if (done) logger.log(`${done} copie(s) d'aperçu créée(s)`);
  return done;
}
