import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CounselorShell } from "@/components/counselor/CounselorShell";
import { redirect } from "@/i18n/navigation";
import { getCounselor } from "@/lib/counselor";
import { signInHref } from "@/lib/next-path";
import { getSessionMember } from "@/lib/session";

// Espace interne : jamais indexé
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Espace conseiller (section 7) : réservé aux conseillers créés par l'administration.
 * Toute autre personne reçoit une page introuvable : l'existence de l'espace n'est pas révélée.
 */
export default async function CounselorLayout({ children }: { children: ReactNode }) {
  const member = await getSessionMember();
  if (!member) return redirect({ href: signInHref("/conseiller"), locale: await getLocale() });
  const counselor = await getCounselor();
  if (!counselor) notFound();

  // Tous les textes, y compris ceux des espaces privés (la racine n'envoie que les publics)
  return (
    <NextIntlClientProvider>
      <div data-theme={counselor.darkMode ? "dark" : undefined} className="min-h-svh bg-bg text-fg">
        <CounselorShell counselor={counselor}>{children}</CounselorShell>
      </div>
    </NextIntlClientProvider>
  );
}
