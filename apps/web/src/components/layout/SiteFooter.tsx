import { EnvelopeSimpleIcon, PhoneIcon, WhatsappLogoIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Container } from "@/components/ui/Container";
import { siteContact } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { LanguageMenu } from "./LanguageSwitcher";
import { homeSections, nav } from "./navItems";
import { SocialLinks } from "./SocialLinks";

/**
 * Pied de page : phrase de clôture et action, puis la marque et ses réseaux,
 * les rubriques, les informations et les coordonnées. Fond noir encre, sans couleur dorée.
 */
export async function SiteFooter() {
  const t = await getTranslations();
  const year = new Date().getFullYear();
  const toComplete = t("Common.toComplete");

  const contacts = [
    { key: "phone", Icon: PhoneIcon, value: siteContact.phone, href: siteContact.phone && `tel:${siteContact.phone}` },
    {
      key: "email",
      Icon: EnvelopeSimpleIcon,
      value: siteContact.email,
      href: siteContact.email && `mailto:${siteContact.email}`,
    },
    {
      key: "whatsapp",
      Icon: WhatsappLogoIcon,
      value: siteContact.whatsapp,
      href: siteContact.whatsapp && `https://wa.me/${siteContact.whatsapp.replace(/\D/g, "")}`,
    },
  ] as const;

  const houseLinks = [...homeSections.filter((item) => item.key !== "faq"), nav.about, nav.faq];
  const infoLinks = [
    { href: nav.rules.href, label: t("Footer.rules") },
    { href: "/confidentialite", label: t("Footer.privacy") },
    { href: "/mentions-legales", label: t("Footer.legal") },
    { href: nav.contact.href, label: t("Nav.contact") },
  ];

  return (
    <footer className="surface-inverse bg-bg-inverse pb-[calc(4rem+env(safe-area-inset-bottom))] text-fg-inverse lg:pb-0">
      {/* Clôture */}
      <Container className="flex flex-col gap-10 border-b border-line py-16 md:flex-row md:items-end md:justify-between lg:py-24">
        <p className="max-w-2xl font-serif text-3xl leading-tight">{t("Footer.ctaTitle")}</p>
        <ButtonLink href="/inscription" variant="inverse" className="self-start md:self-auto">
          {t("Common.becomeMember")}
        </ButtonLink>
      </Container>

      <Container className="grid grid-cols-2 gap-x-6 gap-y-14 py-16 lg:grid-cols-12 lg:gap-10 lg:py-20">
        <div className="col-span-2 lg:col-span-4">
          <Link href="/" aria-label={t("Common.logoAlt")} className="inline-flex text-fg-inverse">
            <Logo size="lg" />
          </Link>
          <p className="mt-8 max-w-sm text-sm leading-relaxed text-fg-inverse-muted">{t("Footer.tagline")}</p>
          <h2 className="eyebrow mt-10 text-fg-inverse-muted">{t("Social.title")}</h2>
          <SocialLinks className="mt-5" />
        </div>

        <FooterColumn title={t("Footer.linksTitle")} className="lg:col-span-2 lg:col-start-6">
          {houseLinks.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="link-rule">
                {t(`Nav.${item.key}`)}
              </Link>
            </li>
          ))}
        </FooterColumn>

        <FooterColumn title={t("Footer.legalTitle")} className="lg:col-span-2">
          {infoLinks.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="link-rule">
                {link.label}
              </Link>
            </li>
          ))}
        </FooterColumn>

        <FooterColumn title={t("Footer.contactTitle")} className="col-span-2 lg:col-span-3 lg:col-start-10">
          {contacts.map(({ key, Icon, value, href }) => (
            <li key={key} className="flex items-center gap-3">
              <Icon size={18} weight="light" aria-hidden="true" className="shrink-0 text-fg-inverse-muted" />
              <span className="sr-only">{t(`Footer.${key}`)} :</span>
              {value && href ? (
                <a href={href} className="link-rule">
                  {value}
                </a>
              ) : (
                <span className="text-fg-inverse-muted">{toComplete}</span>
              )}
            </li>
          ))}
        </FooterColumn>
      </Container>

      <div className="border-t border-line">
        <Container className="flex items-center justify-between gap-4 py-4 text-xs text-fg-inverse-muted">
          <p>{t("Footer.rights", { year })}</p>
          <LanguageMenu tone="inverse" direction="up" className="-mr-2" />
        </Container>
      </div>
    </footer>
  );
}

function FooterColumn({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <h2 className="eyebrow text-fg-inverse-muted">{title}</h2>
      <ul className="mt-6 space-y-3.5 text-sm">{children}</ul>
    </div>
  );
}
