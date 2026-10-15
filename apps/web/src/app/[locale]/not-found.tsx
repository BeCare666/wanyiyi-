import { getTranslations } from "next-intl/server";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Container } from "@/components/ui/Container";
import { getSessionMember } from "@/lib/session";

export default async function NotFound() {
  const t = await getTranslations();
  const member = await getSessionMember();
  return (
    <>
      <SiteHeader member={member} />
      <main id="contenu" className="pb-section pt-44">
        <Container className="max-w-3xl text-center">
          <p aria-hidden="true" className="font-serif text-5xl font-light text-fg-muted">404</p>
          <h1 className="mt-6 text-4xl">{t("NotFound.title")}</h1>
          <p className="mt-6 text-fg-muted">{t("NotFound.text")}</p>
          <ButtonLink href="/" variant="secondary" className="mt-10">
            {t("Common.backHome")}
          </ButtonLink>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
