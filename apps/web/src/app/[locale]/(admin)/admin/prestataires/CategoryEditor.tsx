"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { type Localized, type ProviderCategory, providerLocales, validCategoryKey } from "@/lib/providers";
import { saveCategory } from "./actions";

const knownErrors = new Set(["invalid_key", "name_required", "invalid_position", "forbidden", "unavailable"]);

/**
 * Une catégorie de prestataires (phase 4, question 2 a : liste modifiable par l'administration) :
 * nom en 3 langues, ordre d'affichage, active ou non. Sans catégorie : formulaire d'ajout.
 */
export function CategoryEditor({ category }: { category?: ProviderCategory }) {
  const t = useTranslations("Admin.providers.categories");
  const router = useRouter();
  const [key, setKey] = useState(category?.key ?? "");
  const [name, setName] = useState<Localized>(category?.name ?? {});
  const [position, setPosition] = useState(String(category?.position ?? 10));
  const [active, setActive] = useState(category?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!validCategoryKey(key)) return setError("invalid_key");
    if ((name.fr ?? "").trim() === "") return setError("name_required");
    setError(null);
    startTransition(async () => {
      const result = await saveCategory(key, name, Number(position), active);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setSaved(true);
      if (!category) {
        setKey("");
        setName({});
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 border-b border-line py-6 md:grid-cols-12 md:items-end">
      <label className="block md:col-span-2">
        <span className="text-sm">{t("key")}</span>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value.trim().toLowerCase())}
          readOnly={Boolean(category)}
          maxLength={40}
          className={cn(fieldClass, "text-base read-only:text-fg-muted")}
        />
      </label>
      {providerLocales.map((l) => (
        <label key={l} className="block md:col-span-2">
          <span className="text-sm">{t(`name.${l}`)}</span>
          <input
            value={name[l] ?? ""}
            onChange={(e) => {
              setName((n) => ({ ...n, [l]: e.target.value }));
              setSaved(false);
            }}
            maxLength={60}
            className={cn(fieldClass, "text-base")}
          />
        </label>
      ))}
      <label className="block md:col-span-1">
        <span className="text-sm">{t("position")}</span>
        <input value={position} onChange={(e) => setPosition(e.target.value)} inputMode="numeric" maxLength={4} className={cn(fieldClass, "text-base")} />
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 md:col-span-1">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        <span className="text-sm">{t("active")}</span>
      </label>
      <div className="md:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {category ? t("save") : t("add")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="border-l border-accent pl-5 text-sm md:col-span-12">
          {t(`errors.${error}`)}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-fg-muted md:col-span-12">
          {t("saved")}
        </p>
      )}
    </form>
  );
}
