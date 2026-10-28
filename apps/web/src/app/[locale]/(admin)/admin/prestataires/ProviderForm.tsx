"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { type ChangeEvent, type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { checkProvider, DESCRIPTION_MAX, localized, type ProviderCategory, type ProviderInput, providerLocales } from "@/lib/providers";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { checkPhotoFile, PHOTO_TYPES } from "../../../(membre)/espace/profil/photos";
import { saveProvider, setProviderActive } from "./actions";

const empty: ProviderInput = { name: "", category: "", description: {}, phone: "", whatsapp: "", city: "Cotonou", district: "", priceRange: "", isDemo: false };
const knownErrors = new Set([
  "name",
  "category",
  "description",
  "description_length",
  "phone",
  "contact",
  "place",
  "price_range",
  "name_required",
  "invalid_category",
  "description_required",
  "description_too_long",
  "invalid_phone",
  "contact_required",
  "invalid_place",
  "price_range_too_long",
  "forbidden",
  "unavailable",
]);
const imageErrors = new Set(["photo_type", "photo_too_large", "photo_unreadable", "image_storage", "forbidden", "not_authenticated", "unavailable"]);

/**
 * Fiche d'un prestataire (phase 4, question 2) : création, puis modification avec l'image
 * (envoyée par le navigateur à l'API, qui la dépose sur Cloudinary) et la désactivation.
 */
export function ProviderForm({
  id = null,
  initial = empty,
  categories,
  active = true,
  imageUrl = null,
}: {
  id?: string | null;
  initial?: ProviderInput;
  categories: ProviderCategory[];
  active?: boolean;
  imageUrl?: string | null;
}) {
  const t = useTranslations("Admin.providers.form");
  const locale = useLocale();
  const router = useRouter();
  const [provider, setProvider] = useState<ProviderInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof ProviderInput>(key: K, value: ProviderInput[K]) => {
    setProvider((p) => ({ ...p, [key]: value }));
    setSaved(false);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = checkProvider(provider);
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const result = await saveProvider(id, provider);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      if (id === null) return router.push(`/admin/prestataires/${result.data}`);
      setSaved(true);
      router.refresh();
    });
  }

  const toggle = () => {
    if (!id) return;
    startTransition(async () => {
      const result = await setProviderActive(id, !active);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  };

  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !id) return;
    setImageError(null);
    const invalid = checkPhotoFile(file);
    if (invalid) return setImageError(invalid);
    startTransition(async () => {
      const supabase = createSupabaseBrowser();
      const base = process.env.NEXT_PUBLIC_API_URL;
      const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
      if (!base || !token) return setImageError(base ? "not_authenticated" : "unavailable");
      const body = new FormData();
      body.append("image", file);
      try {
        const response = await fetch(`${base}/admin/providers/${id}/image`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
          const code = response.status === 413 ? "photo_too_large" : typeof payload?.message === "string" ? payload.message : "generic";
          return setImageError(imageErrors.has(code) ? code : "generic");
        }
      } catch {
        return setImageError("unavailable");
      }
      router.refresh();
    });
  };

  const choices = categories.filter((c) => c.is_active || c.key === initial.category);

  return (
    <div className="grid gap-10">
      <form onSubmit={submit} noValidate className="grid gap-8">
        <div className="grid gap-8 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">{t("name")}</span>
            <input value={provider.name} onChange={(e) => set("name", e.target.value)} maxLength={120} className={cn(fieldClass, "text-base")} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t("category")}</span>
            <select value={provider.category} onChange={(e) => set("category", e.target.value)} className={cn(fieldClass, "text-base")}>
              <option value="">{t("chooseCategory")}</option>
              {choices.map((c) => (
                <option key={c.key} value={c.key}>
                  {localized(c.name, locale)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="grid gap-6">
          <legend className="text-sm font-medium">{t("description")}</legend>
          <p className="text-xs text-fg-muted">{t("descriptionHelp", { max: DESCRIPTION_MAX })}</p>
          {providerLocales.map((l) => (
            <label key={l} className="block">
              <span className="text-sm">{t(`languages.${l}`)}</span>
              <textarea
                value={provider.description[l] ?? ""}
                onChange={(e) => set("description", { ...provider.description, [l]: e.target.value })}
                maxLength={DESCRIPTION_MAX}
                rows={3}
                className={cn(fieldClass, "text-base")}
              />
            </label>
          ))}
        </fieldset>

        <div className="grid gap-8 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">{t("phone")}</span>
            <input value={provider.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" maxLength={20} className={cn(fieldClass, "text-base")} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t("whatsapp")}</span>
            <input value={provider.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} inputMode="tel" maxLength={20} className={cn(fieldClass, "text-base")} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t("city")}</span>
            <input value={provider.city} onChange={(e) => set("city", e.target.value)} maxLength={80} className={cn(fieldClass, "text-base")} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t("district")}</span>
            <input value={provider.district} onChange={(e) => set("district", e.target.value)} maxLength={80} className={cn(fieldClass, "text-base")} />
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-medium">{t("priceRange")}</span>
            <span className="mt-1 block text-xs text-fg-muted">{t("priceRangeHelp")}</span>
            <input value={provider.priceRange} onChange={(e) => set("priceRange", e.target.value)} maxLength={80} className={cn(fieldClass, "text-base")} />
          </label>
        </div>

        <label className="flex min-h-12 cursor-pointer items-center gap-3">
          <input type="checkbox" checked={provider.isDemo} onChange={(e) => set("isDemo", e.target.checked)} className="size-4 accent-[var(--accent)]" />
          <span>{t("isDemo")}</span>
        </label>

        {error && (
          <p role="alert" className="border-l border-accent pl-5">
            {t(`errors.${error}`)}
          </p>
        )}
        {saved && !error && (
          <p role="status" className="text-sm text-fg-muted">
            {t("saved")}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {id === null ? t("create") : t("save")}
          </Button>
        </div>
      </form>

      {id !== null && (
        <>
          <section aria-labelledby="image" className="border-t border-line pt-8">
            <h2 id="image" className="text-2xl">
              {t("image")}
            </h2>
            <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("imageHelp")}</p>
            {/* Image publique hébergée par Cloudinary (vitrine) */}
            {imageUrl && (
              <Image src={imageUrl} alt={t("imageAlt", { name: initial.name })} width={640} height={480} className="mt-6 aspect-[4/3] w-full max-w-md object-cover" />
            )}
            <div className="mt-6">
              <input type="file" accept={PHOTO_TYPES.join(",")} onChange={upload} className="sr-only" id="provider-image" />
              <label
                htmlFor="provider-image"
                aria-disabled={pending}
                className="inline-flex min-h-12 cursor-pointer items-center rounded-sm border border-fg px-6 text-sm aria-disabled:cursor-wait aria-disabled:opacity-50"
              >
                {imageUrl ? t("replaceImage") : t("addImage")}
              </label>
            </div>
            {imageError && (
              <p role="alert" className="mt-4 border-l border-accent pl-5 text-sm">
                {t(`imageErrors.${imageError}`)}
              </p>
            )}
          </section>

          <section aria-labelledby="visibilite" className="border-t border-line pt-8">
            <h2 id="visibilite" className="text-2xl">
              {t("visibility")}
            </h2>
            <p className="mt-3 max-w-measure text-sm text-fg-muted">{active ? t("activeHelp") : t("inactiveHelp")}</p>
            <div className="mt-6">
              <Button type="button" variant="secondary" disabled={pending} onClick={toggle}>
                {active ? t("deactivate") : t("activate")}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
