import type { SessionMember } from "@/lib/session";
import { cn } from "@/lib/cn";

type Tone = "rose" | "night";

const tones: Record<Tone, string> = {
  rose: "bg-rose-powder text-ink",
  night: "bg-night text-ivory",
};

/**
 * Avatar du membre connecté (section 6.1) : aucune photo avant le match, donc un monogramme,
 * initiales en serif sur fond rose poudré ou bleu nuit, jamais une silhouette générique.
 * Seule exception aux rayons de 0 à 4 px, demandée pour l'avatar.
 */
export function MemberAvatar({
  member,
  size = 40,
  tone = "rose",
  className,
}: {
  member: Pick<SessionMember, "initials">;
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-line-strong/60 ring-offset-2 ring-offset-bg",
        tones[tone],
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="font-serif leading-none tracking-wide" style={{ fontSize: Math.round(size * 0.4) }}>
        {member.initials}
      </span>
    </span>
  );
}
