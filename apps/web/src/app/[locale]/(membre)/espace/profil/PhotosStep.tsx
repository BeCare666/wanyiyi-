"use client";

import { TrashIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type ChangeEvent, useState, useTransition } from "react";
import { ProtectedPhoto } from "@/components/ui/ProtectedPhoto";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { ownPhotoLink, removePhoto } from "./actions";
import { canAddPhoto, checkPhotoFile, MAX_PHOTOS, type MyPhoto, PHOTO_TYPES } from "./photos";

const knownErrors = new Set(["photo_type", "photo_too_large", "photo_unreadable", "too_many_photos", "not_authenticated", "unavailable"]);

/**
 * Mes photos (section 10.2 ; question 10 de la phase 3) : 1 à 3 photos, relues par l'équipe avant
 * d'être montrées, et seulement après un match. Le fichier part du navigateur directement vers
 * l'API avec le jeton du membre (une photo de 8 Mo dépasse la limite des fonctions du site).
 */
export function PhotosStep({ photos }: { photos: MyPhoto[] }) {
  const t = useTranslations("Member.profile.photos");
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
        const response = await fetch(`${base}/photos`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
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
      const result = await removePhoto(id);
      if (!result.ok) return setError("generic");
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="mes-photos" className="mt-12 border-t border-line pt-8">
      <h2 id="mes-photos" className="text-2xl">
        {t("title")}
      </h2>
      <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("intro", { max: MAX_PHOTOS })}</p>

      {photos.length > 0 && (
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, i) => (
            <li key={photo.id} className="border-t border-line pt-4">
              <ProtectedPhoto load={ownPhotoLink.bind(null, photo.id)} alt={t("alt", { rank: i + 1 })} />
              <p className="mt-3 text-sm">
                {photo.status === "rejected" ? t("rejected", { note: photo.note ?? "" }) : t(`status.${photo.status}`)}
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(photo.id)}
                className="mt-2 inline-flex min-h-10 items-center gap-2 text-sm text-fg-muted hover:text-fg disabled:opacity-50"
              >
                <TrashIcon size={16} weight="light" aria-hidden="true" />
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {canAddPhoto(photos) ? (
        <div className="mt-6">
          <input type="file" accept={PHOTO_TYPES.join(",")} onChange={upload} className="sr-only" id="photo-file" />
          <label
            htmlFor="photo-file"
            aria-disabled={pending}
            className="inline-flex min-h-12 cursor-pointer items-center rounded-sm border border-fg px-6 text-sm aria-disabled:cursor-wait aria-disabled:opacity-50"
          >
            {pending ? t("sending") : t("add")}
          </label>
          <p className="mt-2 text-xs text-fg-muted">{t("formats")}</p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-fg-muted">{t("full", { max: MAX_PHOTOS })}</p>
      )}

      {error && (
        <p role="alert" className="mt-4 border-l border-accent pl-5 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </section>
  );
}
