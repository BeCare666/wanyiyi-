"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { openDocument } from "./actions";

/**
 * Ouvre une pièce dans un nouvel onglet par un lien signé de courte durée.
 * L'onglet est ouvert avant l'appel (sinon le navigateur le bloque), puis dirigé vers le lien.
 */
export function DocumentButton({ documentId, label }: { documentId: string; label: string }) {
  const t = useTranslations("Admin.verifications");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function open() {
    setFailed(false);
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    startTransition(async () => {
      const result = await openDocument(documentId);
      if (!result.ok) {
        tab?.close();
        return setFailed(true);
      }
      if (tab) tab.location.href = result.data.url;
      else window.location.assign(result.data.url);
    });
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-fg px-4 text-sm disabled:opacity-50"
      >
        <ArrowSquareOutIcon size={16} weight="light" aria-hidden="true" />
        {label}
      </button>
      {failed && (
        <span role="alert" className="mt-2 text-xs text-fg-muted">
          {t("openFailed")}
        </span>
      )}
    </span>
  );
}
