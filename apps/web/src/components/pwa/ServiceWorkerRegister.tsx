"use client";

import { useEffect } from "react";

/** Enregistre le service worker en production uniquement (évite les caches gênants en développement). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // L'application fonctionne sans service worker : l'échec est silencieux.
    });
  }, []);
  return null;
}
