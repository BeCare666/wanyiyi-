import { AndroidLogoIcon, AppleLogoIcon, DownloadSimpleIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { androidApp, sectionIds } from "@/config/site";

/** L'application : téléchargement de l'APK Android, et installation depuis Safari sur iPhone. */
export async function AppDownload() {
  const t = await getTranslations("AppDownload");
  const steps = [t("step1"), t("step2"), t("step3")];

  return (
    <section id={sectionIds.app} aria-labelledby="app-title" className="py-section">
      <Container>
        <Reveal>
          <SectionHeading id="app-title" eyebrow={t("eyebrow")} title={t("title")} />
          <p className="mt-6 max-w-2xl text-fg-muted">{t("intro")}</p>
        </Reveal>

        <div className="mt-14 grid gap-12 border-t border-line pt-12 md:grid-cols-2 md:gap-16">
          <Reveal>
            <h3 className="flex items-center gap-3 text-2xl">
              <AndroidLogoIcon aria-hidden="true" weight="light" className="size-7" />
              {t("androidTitle")}
            </h3>
            <a
              href={androidApp.apkPath}
              download="ifedele.apk"
              type="application/vnd.android.package-archive"
              className="group relative isolate mt-8 inline-flex min-h-12 items-center justify-center gap-3 overflow-hidden rounded-sm bg-accent px-7 text-xs font-medium uppercase tracking-[0.16em] text-accent-fg"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-ink/25 opacity-0 transition-opacity duration-500 ease-soft group-hover:opacity-100 group-focus-visible:opacity-100"
              />
              <DownloadSimpleIcon aria-hidden="true" weight="light" className="size-5" />
              {t("download")}
            </a>
            <p className="mt-3 text-sm text-fg-muted">
              {t("details", { version: androidApp.version, size: androidApp.sizeMb, android: androidApp.minAndroid })}
            </p>
            <ol className="mt-8 space-y-3 text-sm text-fg-muted">
              {steps.map((step, i) => (
                <li key={step} className="flex gap-4">
                  <span aria-hidden="true" className="font-serif text-lg leading-none text-fg">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal delay={0.08} className="md:pt-16">
            <h3 className="flex items-center gap-3 text-2xl">
              <AppleLogoIcon aria-hidden="true" weight="light" className="size-7" />
              {t("iphoneTitle")}
            </h3>
            <p className="mt-6 text-fg-muted">{t("iphoneText")}</p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
