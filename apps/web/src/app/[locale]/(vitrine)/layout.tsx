import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { getSessionMember } from "@/lib/session";

export default async function VitrineLayout({ children }: { children: ReactNode }) {
  const member = await getSessionMember();
  return (
    <>
      <SiteHeader member={member} />
      <main id="contenu">{children}</main>
      <SiteFooter />
    </>
  );
}
