import {
  CalendarIcon,
  ChatsCircleIcon,
  EyeSlashIcon,
  FlagIcon,
  HandHeartIcon,
  SealCheckIcon,
} from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { Flag } from "@/components/brand/Flag";
import { Logo } from "@/components/brand/Logo";
import { MemberAvatar } from "@/components/layout/MemberAvatar";
import { SocialLinks } from "@/components/layout/SocialLinks";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Container } from "@/components/ui/Container";

/*
 * Page interne de référence du système de design (section 13 de la note).
 * Documentation destinée à l'équipe : elle n'est ni indexée ni traduite.
 */

export const metadata: Metadata = { title: "Système de design", robots: { index: false, follow: false } };

const colors = [
  ["ink", "Noir encre", "Textes principaux, fonds sombres"],
  ["ivory", "Blanc ivoire", "Fond principal"],
  ["white", "Blanc", "Surfaces claires ponctuelles"],
  ["rose-powder", "Rose poudré", "Fonds doux, survols, accent en mode sombre"],
  ["rose-deep", "Rose profond", "Accent principal, actions"],
  ["night", "Bleu nuit", "Sections sombres, administration"],
  ["steel", "Bleu acier", "Liens, états d'information"],
  ["silver", "Gris argent", "Textes secondaires sur fond sombre (neutre, sans reflet doré)"],
] as const;

const stones = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const typeScale = [
  ["text-5xl", "Titre d'ouverture"],
  ["text-4xl", "Titre de page"],
  ["text-3xl", "Titre de section"],
  ["text-2xl", "Sous-titre"],
  ["text-xl", "Intertitre"],
  ["text-lg", "Chapeau"],
  ["text-base", "Texte courant"],
  ["text-sm", "Texte secondaire"],
  ["text-xs", "Mentions, surtitres"],
] as const;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-8 border-t border-line py-14 lg:grid-cols-12">
      <h2 className="text-2xl lg:col-span-3">{title}</h2>
      <div className="lg:col-span-9">{children}</div>
    </section>
  );
}

export default async function DesignSystemPage() {
  return (
    <main id="contenu" className="py-20">
      <Container>
        <header className="pb-14">
          <p className="eyebrow">Référence interne</p>
          <h1 className="mt-6 text-4xl">Système de design Ifedele</h1>
          <p className="mt-6 max-w-measure text-fg-muted">
            Toutes les valeurs proviennent des jetons de <code>src/app/globals.css</code>. Aucun composant ne
            contient de couleur codée en dur.
          </p>
        </header>

        <Block title="Logo">
          <div className="grid gap-px bg-line sm:grid-cols-3">
            <div className="flex h-40 items-center justify-center bg-ivory text-ink">
              <Logo />
            </div>
            <div className="flex h-40 items-center justify-center bg-ivory text-ink">
              <Logo variant="stacked" />
            </div>
            <div className="surface-night flex h-40 items-center justify-center bg-night text-ivory">
              <Logo />
            </div>
          </div>
        </Block>

        <Block title="Navigation">
          <div className="grid gap-px bg-line sm:grid-cols-3">
            <div className="flex flex-col items-center justify-center gap-4 bg-bg p-8 text-sm">
              <div className="flex items-center gap-4">
                {(["fr", "en", "yo"] as const).map((l) => (
                  <span key={l} className="flex items-center gap-2 uppercase">
                    <Flag locale={l} className="w-7" />
                    {l}
                  </span>
                ))}
              </div>
              <p className="text-xs text-fg-muted">Drapeaux du sélecteur de langue</p>
            </div>
            <div className="flex flex-col items-center justify-center gap-4 bg-bg p-8">
              {/* Membre fictif, pour montrer l'état connecté de l'en-tête */}
              <div className="flex items-center gap-4">
                <MemberAvatar member={{ initials: "AH" }} size={36} />
                <MemberAvatar member={{ initials: "AH" }} size={44} tone="night" />
              </div>
              <p className="text-xs text-fg-muted">Avatar d&apos;un membre connecté (remplace « Devenir membre »)</p>
            </div>
            <div className="surface-inverse flex flex-col items-center justify-center gap-4 bg-ink p-8 text-ivory">
              <SocialLinks size="sm" />
              <p className="text-xs text-silver">Réseaux sociaux (liens à communiquer)</p>
            </div>
          </div>
          <p className="mt-6 text-sm text-fg-muted">
            Aucune couleur or ou dorée dans l&apos;interface : vérifié par <code>tests/design-tokens.test.ts</code>.
          </p>
        </Block>

        <Block title="Couleurs">
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {colors.map(([token, name, usage]) => (
              <li key={token} className="bg-bg">
                <div className="h-24 border-b border-line" style={{ background: `var(--${token})` }} />
                <div className="p-4">
                  <p className="font-medium">{name}</p>
                  <p className="text-xs text-fg-muted">--{token}</p>
                  <p className="mt-2 text-sm text-fg-muted">{usage}</p>
                </div>
              </li>
            ))}
          </ul>
          <ul className="mt-8 grid grid-cols-9">
            {stones.map((s) => (
              <li key={s} className="text-center text-xs text-fg-muted">
                <div className="h-12" style={{ background: `var(--stone-${s})` }} />
                <span className="mt-2 block">{s}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-fg-muted">
            Les combinaisons texte et fond sont vérifiées automatiquement (WCAG AA) par{" "}
            <code>tests/design-tokens.test.ts</code>.
          </p>
        </Block>

        <Block title="Typographie">
          <p className="text-sm text-fg-muted">
            Titres : EB Garamond. Textes et interface : Montserrat. Tailles fluides (clamp).
          </p>
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {typeScale.map(([cls, usage], i) => (
              <li key={cls} className="grid items-baseline gap-4 py-5 md:grid-cols-[10rem_1fr]">
                <span className="text-xs text-fg-muted">
                  {cls} · {usage}
                </span>
                <span className={`${cls} ${i < 6 ? "font-serif" : ""} leading-tight`}>Une union qui se construit</span>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Yoruba">
          <p className="text-sm text-fg-muted">
            Contrôle visuel des lettres à point souscrit et des accents tonals dans les deux polices.
          </p>
          <p className="mt-6 font-serif text-4xl" lang="yo">
            Ẹ ẹ́ ẹ̀ · Ọ ọ́ ọ̀ · Ṣ ṣ · ń ǹ ḿ · Ìfohùnṣọ̀kan
          </p>
          <p className="mt-4 text-2xl" lang="yo">
            Ẹ ẹ́ ẹ̀ · Ọ ọ́ ọ̀ · Ṣ ṣ · ń ǹ ḿ · Ìfohùnṣọ̀kan
          </p>
        </Block>

        <Block title="Actions">
          <div className="flex flex-wrap gap-4">
            <ButtonLink href="/design-system">Action principale</ButtonLink>
            <ButtonLink href="/design-system" variant="secondary">
              Action secondaire
            </ButtonLink>
          </div>
          <div className="surface-night mt-6 flex flex-wrap gap-4 bg-night p-6">
            <ButtonLink href="/design-system" variant="inverse">
              Action sur fond sombre
            </ButtonLink>
          </div>
          <p className="mt-6">
            <a href="#contenu" className="link-rule text-link">
              Lien avec filet qui se dessine au survol
            </a>
          </p>
        </Block>

        <Block title="Icônes">
          <p className="text-sm text-fg-muted">Phosphor, graisse light (thin au-delà de 40 px). Une seule famille.</p>
          <ul className="mt-6 flex flex-wrap gap-8 text-fg">
            {[SealCheckIcon, EyeSlashIcon, ChatsCircleIcon, FlagIcon, CalendarIcon, HandHeartIcon].map((I, i) => (
              <li key={i}>
                <I size={28} weight="light" aria-hidden="true" />
              </li>
            ))}
            <li>
              <SealCheckIcon size={48} weight="thin" aria-hidden="true" />
            </li>
          </ul>
        </Block>

        <Block title="Formes et animations">
          <ul className="space-y-3 text-fg-muted">
            <li>Rayons : 0, 2 ou 4 px. Pas d&apos;ombre : hiérarchie par l&apos;espace et les filets de 1 px.</li>
            <li>Courbe : cubic-bezier(0.22, 1, 0.36, 1). Durées : 300, 500 et 700 ms.</li>
            <li>Seules les propriétés transform et opacity sont animées.</li>
            <li>prefers-reduced-motion : les déplacements sont supprimés, les apparitions deviennent immédiates.</li>
          </ul>
        </Block>
      </Container>
    </main>
  );
}
