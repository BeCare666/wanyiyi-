import { InternalServerErrorException, ServiceUnavailableException } from "@nestjs/common";
import { unwrap } from "../supabase/db-errors";
import type { AppClient } from "../supabase/supabase.service";

/** Compartiment privé des pièces et selfies (migration 20261017000100). */
export const ID_DOCUMENTS_BUCKET = "id-documents";
/** Durée du lien (paramètre de la base, 300 s : décision du 17 octobre 2026). */
export const LINK_SECONDS_SETTING = "safety.signed_id_document_url_seconds";

/**
 * Lien signé vers une pièce, pour l'équipe de vérification.
 * 1. app.open_id_document, appelée avec le jeton de la personne : permission vérifiée
 *    dans la base et ouverture journalisée (id_document.viewed) ;
 * 2. création du lien avec la clé service role (le compartiment n'a aucune lecture pour
 *    les clients), usage lui-même journalisé par SupabaseService.system.
 */
export async function documentLink(
  member: AppClient,
  system: (reason: string) => AppClient,
  documentId: string,
  actorId: string,
): Promise<{ url: string; expiresIn: number }> {
  const path = unwrap(await member.rpc("open_id_document", { p_document: documentId })) as string;
  const setting = unwrap(await member.from("settings").select("value").eq("key", LINK_SECONDS_SETTING).maybeSingle()) as {
    value: unknown;
  } | null;
  const seconds = Number(setting?.value);
  // Aucune durée par défaut inventée : sans paramètre valide, pas de lien
  if (!Number.isInteger(seconds) || seconds <= 0) throw new ServiceUnavailableException("setting_missing");

  const { data, error } = await system(`lien signé de ${seconds} s vers la pièce ${documentId}, demandé par ${actorId}`)
    .storage.from(ID_DOCUMENTS_BUCKET)
    .createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new InternalServerErrorException("storage_error");
  return { url: data.signedUrl, expiresIn: seconds };
}
