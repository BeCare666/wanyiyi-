"use client";

import { TrashIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type ChangeEvent, useState, useTransition } from "react";
import { ProtectedPhoto } from "@/components/ui/ProtectedPhoto";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { checkPhotoFile, PHOTO_TYPES } from "../profil/photos";
import { removeUnionPhoto, unionPhotoLink } from "./actions";
import { canAddUnionPhoto, type CoupleStatus, type MemoryPhotoRow, UNION_PHOTOS_PER_MEMBER } from "./couple";

const knownErrors = new Set(["photo_type", "photo_too_large", "photo_unreadable", "too_many_photos", "not_union", "not_authenticated", "unavailable"]);

/**
 * Photos de l'union (espace souvenir, phase 4, question 1 a) : 3 par membre, relues par l'équipe,
 * visibles des deux seulement, filigranées par un lien de 5 minutes. Comme pour le profil, le
 * fichier part du navigateur directement vers l'API avec le jeton du membre.
 */
export function MemoryPhotos({ coupleId, status, rows, partnerName }: { coupleId: string; status: CoupleStatus; rows: MemoryPhotoRow[]; partnerName: string }) {
  const t = useTranslations("Member.couple.memory");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const invalid = checkPhotoFile(file);
    if (invalid) return setError(invalid);
    startTransition(async () => {
      const supabase = createSupabaseBrowser();
      const base = process.env.NEXT_PUBLIC_API_URL;
      const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
      if (!base || !token) return setError(base ? "not_authenticated" : "unavailable");
      const body = new FormData();
      body.append("photo", file);
      try {
        const response = await fetch(`${base}/photos/union/${coupleId}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
          const code = response.status === 413 ? "photo_too_large" : typeof payload?.message === "string" ? payload.message : "generic";
          return setError(knownErrors.has(code) ? code : "generic");
        }
      } catch {
        return setError("unavailable");
      }
      router.refresh();
    });
  };

  const remove = (id: string) => {
    setError(null);
    startTransition(async () => {
      const result = await removeUnionPhoto(id);
      if (!result.ok) return setError("generic");
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="photos-union" className="mt-14">
      <h2 id="photos-union" className="eyebrow">
        {t("photosTitle")}
      </h2>
      <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("photosHelp", { max: UNION_PHOTOS_PER_MEMBER })}</p>

      {rows.length > 0 && (
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((photo, i) => (
            <li key={photo.photo_id} className="border-t border-line pt-4">
              <ProtectedPhoto load={unionPhotoLink.bind(null, photo.photo_id)} alt={t("photoAlt", { rank: i + 1 })} />
              {photo.mine ? (
                <>
                  <p className="mt-3 text-sm">
                    {photo.review_status === "rejected" ? t("rejected", { note: photo.review_note ?? "" }) : t(`status.${photo.review_status}`)}
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(photo.photo_id)}
                    className="mt-2 inline-flex min-h-10 items-center gap-2 text-sm text-fg-muted hover:text-fg disabled:opacity-50"
                  >
                    <TrashIcon size={16} weight="light" aria-hidden="true" />
                    {t("remove")}
                  </button>
                </>
              ) : (
                <p className="mt-3 text-sm text-fg-muted">{t("byPartner", { name: partnerName })}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAddUnionPhoto(status, rows) ? (
        <div className="mt-6">
          <input type="file" accept={PHOTO_TYPES.join(",")} onChange={upload} className="sr-only" id="photo-union-file" />
          <label
            htmlFor="photo-union-file"
            aria-disabled={pending}
            className="inline-flex min-h-12 cursor-pointer items-center rounded-sm border border-fg px-6 text-sm aria-disabled:cursor-wait aria-disabled:opacity-50"
          >
            {pending ? t("sending") : t("add")}
          </label>
          <p className="mt-2 text-xs text-fg-muted">{t("formats")}</p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-fg-muted">{t("full", { max: UNION_PHOTOS_PER_MEMBER })}</p>
      )}

      {error && (
        <p role="alert" className="mt-4 border-l border-accent pl-5 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </section>
  );
}
