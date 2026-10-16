import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/Logo";
import { LanguageMenu } from "@/components/layout/LanguageSwitcher";
import { Link } from "@/i18n/navigation";

/** En-tête réduit des pages hors coquille (connexion, vote au code QR) : logo et langue. */
export async function MinimalHeader() {
  const t = await getTranslations("Common");
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-gutter">
        <Link href="/" aria-label={t("logoAlt")} className="inline-flex text-fg">
          <Logo />
        </Link>
        <LanguageMenu />
      </div>
    </header>
  );
}
