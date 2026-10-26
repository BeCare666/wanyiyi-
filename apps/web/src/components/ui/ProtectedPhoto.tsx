"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ApiResult } from "@/lib/api";
import { Button } from "./Button";

/**
 * Photo d'un membre (section 10.2) : chargée à la demande par un lien de 5 minutes vers l'image
 * filigranée par le serveur. Clic droit, appui long et glisser-déposer sont désactivés : c'est une
 * simple dissuasion (une capture d'écran reste possible), la protection réelle est le filigrane.
 */
export function ProtectedPhoto({ load, alt }: { load: () => Promise<ApiResult<{ url: string }>>; alt: string }) {
  const t = useTranslations("Photos");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const show = () => {
    setError(false);
    startTransition(async () => {
      const result = await load();
      if (result.ok) setUrl(result.data.url);
      else setError(true);
    });
  };

  if (url) {
    return (
      // Image servie par l'API (lien de 5 minutes), pas par l'optimiseur d'images du site
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        onError={() => {
          setUrl(null);
          setError(true);
        }}
        className="max-h-96 w-auto select-none rounded-sm border border-line [-webkit-touch-callout:none]"
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" disabled={pending} onClick={show}>
        {pending ? t("loading") : t("show")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-fg-muted">
          {t("error")}
        </p>
      )}
    </div>
  );
}
