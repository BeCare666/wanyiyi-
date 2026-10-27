import { SignOutIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { LanguageMenu } from "@/components/layout/LanguageSwitcher";
import { MemberAvatar } from "@/components/layout/MemberAvatar";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/auth-actions";
import type { CounselorMember } from "@/lib/counselor";

export const counselorHome = "/conseiller";

/**
 * Coquille de l'espace conseiller (section 7) : séparée de l'administration et de l'espace membre.
 * En-tête sur fond encre : logo, couples suivis, langue, conseiller connecté, déconnexion.
 */
export async function CounselorShell({ counselor, children }: { counselor: CounselorMember; children: ReactNode }) {
  const t = await getTranslations("Counselor");
  return (
    <div className="flex min-h-svh flex-col">
      <header data-theme="dark" className="sticky top-0 z-30 border-b border-line bg-bg text-fg">
        <div className="flex h-16 items-center justify-between gap-4 px-gutter">
          <div className="flex items-center gap-6">
            <Link href={counselorHome} aria-label={t("home")} className="inline-flex text-fg">
              <Logo />
            </Link>
            <p className="eyebrow hidden md:block">{t("areaLabel")}</p>
          </div>
          <nav aria-label={t("areaLabel")} className="flex items-center gap-4">
            <Link href={counselorHome} className="hidden min-h-11 items-center text-sm underline-offset-4 hover:underline sm:inline-flex">
              {t("nav.couples")}
            </Link>
            <LanguageMenu className="hidden sm:block" />
            <span className="flex items-center gap-3">
              <MemberAvatar member={counselor} size={36} tone="night" />
              <span className="hidden text-sm md:block">{counselor.displayName}</span>
            </span>
            <form action={signOut}>
              <button
                type="submit"
                aria-label={t("signOut")}
                className="inline-flex size-11 items-center justify-center rounded-sm opacity-70 transition-opacity duration-300 hover:opacity-100"
              >
                <SignOutIcon size={20} weight="light" aria-hidden="true" />
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main id="contenu" className="flex-1 px-gutter pb-16 pt-10 lg:pt-12">
        {children}
      </main>
    </div>
  );
}
