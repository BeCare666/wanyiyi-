import { describe, expect, it, vi } from "vitest";
import { purgeDeletedAccounts } from "../src/accounts/purge";
import type { AppClient } from "../src/supabase/supabase.service";

/** Effacement des comptes supprimés depuis 30 jours (question 17, 24 octobre 2026). */

type Files = Record<string, string[]>;

/** Faux client système : fonctions de la base, Storage (dossiers par membre) et Auth admin. */
function systemClient(toClean: string[], files: Files, options: { authError?: { message: string; status: number } } = {}) {
  const rpc = vi.fn(async (name: string) => (name === "accounts_to_clean" ? { data: toClean, error: null } : { data: null, error: null }));
  const remove = vi.fn(async (paths: string[]) => {
    for (const path of paths) {
      const [folder, name] = path.split("/") as [string, string];
      files[folder] = (files[folder] ?? []).filter((f) => f !== name);
    }
    return { data: [], error: null };
  });
  const list = vi.fn(async (folder: string) => ({ data: (files[folder] ?? []).map((name) => ({ name })), error: null }));
  const deleteUser = vi.fn(async () => ({ data: null, error: options.authError ?? null }));
  const client = { rpc, storage: { from: vi.fn(() => ({ list, remove })) }, auth: { admin: { deleteUser } } } as unknown as AppClient;
  return { client, rpc, remove, deleteUser };
}

const logger = () => ({ log: vi.fn(), error: vi.fn() });

describe("Effacement des comptes supprimés (question 17)", () => {
  it("base effacée, puis fichiers du selfie, compte Auth en suppression douce, et compte marqué", async () => {
    const files: Files = { u1: ["a.jpg", "b.jpg"], u2: [] };
    const { client, rpc, remove, deleteUser } = systemClient(["u1", "u2"], files);
    const log = logger();
    expect(await purgeDeletedAccounts(client, log)).toBe(2);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["purge_deleted_accounts", "accounts_to_clean", "mark_account_cleaned", "mark_account_cleaned"]);
    expect(remove).toHaveBeenCalledWith(["u1/a.jpg", "u1/b.jpg"]);
    expect(files.u1).toEqual([]);
    expect(deleteUser).toHaveBeenCalledWith("u1", true);
    expect(deleteUser).toHaveBeenCalledWith("u2", true);
    expect(rpc).toHaveBeenCalledWith("mark_account_cleaned", { p_user: "u1" });
    expect(log.error).not.toHaveBeenCalled();
  });

  it("échec du compte Auth : compte non marqué, repris au passage suivant ; compte Auth déjà absent : marqué", async () => {
    const failing = systemClient(["u1"], {}, { authError: { message: "erreur", status: 500 } });
    const log = logger();
    expect(await purgeDeletedAccounts(failing.client, log)).toBe(0);
    expect(failing.rpc).not.toHaveBeenCalledWith("mark_account_cleaned", expect.anything());
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("u1"));

    const gone = systemClient(["u1"], {}, { authError: { message: "User not found", status: 404 } });
    expect(await purgeDeletedAccounts(gone.client, logger())).toBe(1);
  });

  it("erreur de la base : rien d'autre n'est effacé", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "forbidden" } }));
    const storage = { from: vi.fn() };
    const log = logger();
    expect(await purgeDeletedAccounts({ rpc, storage } as unknown as AppClient, log)).toBe(0);
    expect(storage.from).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("forbidden"));
  });
});
