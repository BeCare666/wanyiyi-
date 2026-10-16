import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { MemberShell } from "@/components/member/MemberShell";
import { redirect } from "@/i18n/navigation";
import { signInHref } from "@/lib/next-path";
import { getRecentNotifications, getSessionMember } from "@/lib/session";

// Espace privé : jamais indexé
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Espace membre : réservé aux membres connectés, en mode sombre si le membre l'a choisi. */
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const member = await getSessionMember();
  if (!member) return redirect({ href: signInHref("/espace"), locale: await getLocale() });
  const notifications = await getRecentNotifications();

  return (
    <div data-theme={member.darkMode ? "dark" : undefined} className="min-h-svh bg-bg text-fg">
      <MemberShell member={member} notifications={notifications}>
        {children}
      </MemberShell>
    </div>
  );
}
