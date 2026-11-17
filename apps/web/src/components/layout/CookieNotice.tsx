"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";

/** Clé du stockage local : le visiteur a lu le bandeau (présentée dans la politique de confidentialité). */
export const COOKIE_NOTICE_KEY = "ifedele-cookie-notice";

/**
 * Bandeau d'information sur les cookies, affiché à la première visite jusqu'au clic sur « J'ai compris ».
 * Le site n'utilise que des cookies nécessaires (langue, session) : il informe, sans demander de choix.
 * Sur mobile, il se place au-dessus de la barre de navigation du bas.
 */
export function CookieNotice() {
  const t = useTranslations("Common");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(COOKIE_NOTICE_KEY) === "1";
    } catch {
      // Stockage indisponible (navigation privée) : le bandeau s'affiche
    }
    // Lecture du stockage local possible seulement dans le navigateur, après l'affichage serveur
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) setOpen(true);
  }, []);

  if (!open) return null;

  function close() {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_KEY, "1");
    } catch {
      // Sans stockage, le bandeau reviendra à la prochaine visite
    }
    setOpen(false);
  }

  return (
    <section
      role="region"
      aria-label={t("cookieNoticeLabel")}
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[45] mx-auto max-w-2xl rounded-sm border border-line-strong bg-bg p-5 lg:bottom-6 print:hidden"
    >
      <p className="text-sm text-fg">
        {t("cookieNotice")}{" "}
        <Link href="/confidentialite" className="underline underline-offset-4">
          {t("cookieNoticeMore")}
        </Link>
      </p>
      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={close}>
          {t("cookieNoticeOk")}
        </Button>
      </div>
    </section>
  );
}
