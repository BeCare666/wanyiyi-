import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { redirect } from "@/i18n/navigation";
import { signInHref } from "@/lib/next-path";
import { getSessionMember } from "@/lib/session";
import { getStaffMember } from "@/lib/staff";

// Espace interne : jamais indexé
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Administration (section 11) : réservée à l'équipe (modération, administration, super administration).
 * Un membre ou un conseiller reçoit une page introuvable : l'existence de l'espace n'est pas révélée.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const member = await getSessionMember();
  if (!member) return redirect({ href: signInHref("/admin"), locale: await getLocale() });
  const staff = await getStaffMember();
  if (!staff) notFound();

  return (
    <div data-theme={staff.darkMode ? "dark" : undefined} className="min-h-svh bg-bg text-fg">
      <AdminShell staff={staff}>{children}</AdminShell>
    </div>
  );
}
