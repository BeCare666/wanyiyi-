import { ID_DOCUMENTS_BUCKET } from "../verifications/document-link";
import type { AppClient } from "../supabase/supabase.service";

type Log = { log: (message: string) => void; error: (message: string) => void };

/** Fichiers listés par lot (limite de l'API Storage). */
const PAGE = 100;

/**
 * Effacement des comptes supprimés depuis 30 jours (question 17, 24 octobre 2026), clé service role :
 * 1. app.purge_deleted_accounts efface les données en base (profil, selfie, textes, votes,
 *    notifications) et garde paiements et journal d'audit sans nom ;
 * 2. pour chaque compte effacé en base : fichiers du selfie (dossier du membre dans le compartiment
 *    privé), puis compte Supabase Auth en suppression « douce » (adresse et téléphone effacés, la ligne
 *    reste pour les clés étrangères), puis app.mark_account_cleaned. Un échec est repris au passage
 *    suivant (app.accounts_to_clean rend aussi les comptes d'un passage précédent).
 */
export async function purgeDeletedAccounts(db: AppClient, logger: Log): Promise<number> {
  const { error: purgeError } = await db.rpc("purge_deleted_accounts");
  if (purgeError) {
    logger.error(`Effacement des comptes : ${purgeError.message}`);
    return 0;
  }
  const { data, error } = await db.rpc("accounts_to_clean");
  if (error) {
    logger.error(`Comptes à nettoyer : ${error.message}`);
    return 0;
  }
  let cleaned = 0;
  for (const userId of (data ?? []) as string[]) {
    try {
      await removeFolder(db, userId);
      const { error: authError } = await db.auth.admin.deleteUser(userId, true);
      if (authError && authError.status !== 404) throw new Error(`Auth : ${authError.message}`);
      const { error: markError } = await db.rpc("mark_account_cleaned", { p_user: userId });
      if (markError) throw new Error(`marquage : ${markError.message}`);
      cleaned += 1;
    } catch (e) {
      logger.error(`Compte ${userId} : ${(e as Error).message}`);
    }
  }
  if (cleaned) logger.log(`${cleaned} compte(s) effacé(s) (fichiers et compte Auth)`);
  return cleaned;
}

/** Tous les fichiers du dossier du membre dans le compartiment des selfies. */
async function removeFolder(db: AppClient, userId: string) {
  const bucket = db.storage.from(ID_DOCUMENTS_BUCKET);
  for (;;) {
    const { data, error } = await bucket.list(userId, { limit: PAGE });
    if (error) throw new Error(`Storage : ${error.message}`);
    const paths = (data ?? []).map((f) => `${userId}/${f.name}`);
    if (paths.length === 0) return;
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) throw new Error(`Storage : ${removeError.message}`);
    if (paths.length < PAGE) return;
  }
}
