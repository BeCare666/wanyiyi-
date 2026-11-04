import { CheckIcon } from "@phosphor-icons/react/ssr";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/cn";

export type GuideStep = { key: string; label: string; state: "done" | "current" | "todo" };

/**
 * Guide d'un espace (audit UX du 3 novembre 2026) : la frise des étapes, puis ce qu'il reste à
 * faire maintenant, en une phrase et un bouton. Même esprit que « Votre prochaine étape ».
 */
export function StepGuide({
  label,
  title,
  steps,
  text,
  action,
}: {
  label: string;
  title: string;
  steps: GuideStep[];
  text: string;
  action?: { href: Parameters<typeof ButtonLink>[0]["href"]; label: string } | null;
}) {
  return (
    <aside aria-label={label} className="mt-8 border border-accent bg-bg-soft p-6 md:p-8">
      <ol className="mb-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, i) => (
          <li key={step.key} aria-current={step.state === "current" ? "step" : undefined} className="min-w-0">
            <span
              aria-hidden="true"
              className={cn("block h-1 rounded-full", step.state === "done" ? "bg-fg" : step.state === "current" ? "bg-accent" : "bg-line")}
            />
            <span className={cn("mt-2 flex items-center gap-1 text-xs leading-tight", step.state === "todo" ? "text-fg-muted" : "text-fg")}>
              {step.state === "done" ? <CheckIcon size={12} weight="bold" aria-hidden="true" className="shrink-0" /> : <span aria-hidden="true">{i + 1}.</span>}
              <span className="truncate">{step.label}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="eyebrow">{title}</p>
      <p className="mt-3 max-w-measure font-serif text-xl md:text-2xl">{text}</p>
      {action && (
        <ButtonLink href={action.href} size="sm" className="mt-5" scroll={false}>
          {action.label}
        </ButtonLink>
      )}
    </aside>
  );
}
