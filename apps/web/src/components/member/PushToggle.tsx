"use client";

import { BellRingingIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { removePushSubscription, savePushSubscription } from "./push-actions";
import { type PushState, unsupportedState, vapidKeyBytes } from "./pushSupport";

const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

function supported(): boolean {
  return Boolean(vapidKey) && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Bouton « Activer les notifications » (décision du 04/11/2026) : l'autorisation n'est demandée
 * qu'au clic, jamais à l'ouverture. Variante « card » : encadré de l'espace membre, affiché
 * seulement tant que l'appareil peut être abonné. Variante « settings » : ligne des paramètres,
 * avec l'état de l'appareil et la désactivation.
 */
export function PushToggle({ variant }: { variant: "card" | "settings" }) {
  const t = useTranslations("Member.push");
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported()) return setState(unsupportedState(navigator.userAgent, standalone()));
    const reg = await registration();
    if (!reg) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Appareil déjà abonné : rattaché au membre connecté (changement de compte sur l'appareil)
      const json = sub.toJSON();
      void savePushSubscription({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", userAgent: navigator.userAgent });
    }
    setState(sub ? "on" : "off");
  }, []);

  useEffect(() => {
    // Lecture de l'état du navigateur après l'affichage (aucune donnée côté serveur)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch(() => setState("unsupported"));
  }, [refresh]);

  async function enable() {
    setBusy(true);
    setFailed(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const reg = await registration();
      if (!reg || !vapidKey) return setState("unsupported");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidKey) }));
      const json = sub.toJSON();
      const ok = await savePushSubscription({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", userAgent: navigator.userAgent });
      if (!ok) {
        await sub.unsubscribe();
        setFailed(true);
        return setState("off");
      }
      setState("on");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setFailed(false);
    try {
      const sub = await (await registration())?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const error = failed ? (
    <p role="alert" className="mt-3 border-l border-accent pl-4 text-sm">
      {t("failed")}
    </p>
  ) : null;

  // Clé publique pas encore configurée sur le site : rien à proposer
  if (!vapidKey) return null;

  if (variant === "card") {
    if (state !== "off") return null;
    return (
      <section aria-labelledby="push-card-title" className="mt-10 flex flex-col gap-5 border border-line p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div className="flex gap-4">
          <BellRingingIcon aria-hidden="true" weight="light" className="mt-1 size-7 shrink-0" />
          <div>
            <h2 id="push-card-title" className="text-xl">
              {t("cardTitle")}
            </h2>
            <p className="mt-2 text-sm text-fg-muted">{t("cardText")}</p>
            {error}
          </div>
        </div>
        <Button type="button" onClick={enable} disabled={busy} className="shrink-0">
          {t("enable")}
        </Button>
      </section>
    );
  }

  return (
    <div className="border-b border-line py-4 last:border-b-0">
      <p>{t("title")}</p>
      <p className="mt-1 text-sm text-fg-muted" aria-live="polite">
        {state === "loading" ? " " : t(`state.${state}`)}
      </p>
      {state === "off" && (
        <Button type="button" onClick={enable} disabled={busy} className="mt-4">
          {t("enable")}
        </Button>
      )}
      {state === "on" && (
        <Button type="button" variant="secondary" onClick={disable} disabled={busy} className="mt-4">
          {t("disable")}
        </Button>
      )}
      {error}
    </div>
  );
}
