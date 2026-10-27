"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { chooseMatch, decideDiscovery } from "./actions";

const knownErrors = new Set([
  "no_free_slot",
  "expired",
  "not_pending",
  "already_chosen",
  "couple_exclusivity",
  "not_active",
  "extension_too_early",
  "already_extended",
  "unavailable",
]);

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  };
  return { error, pending, run };
}

function ErrorLine({ error }: { error: string | null }) {
  const t = useTranslations("Member.discoveries.errors");
  return error ? (
    <p role="alert" className="mt-3 border-l border-accent pl-4 text-sm">
      {t(error)}
    </p>
  ) : null;
}

/** Choisir d'ouvrir la découverte d'un match en attente (place libre exigée). */
export function ChooseMatch({ matchId, disabled }: { matchId: string; disabled: boolean }) {
  const t = useTranslations("Member.discoveries");
  const { error, pending, run } = useAction();
  return (
    <div>
      <Button type="button" disabled={disabled || pending} onClick={() => run(() => chooseMatch(matchId))}>
        {t("choose")}
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}

/**
 * Décisions d'une découverte ouverte : « Je veux continuer » et « Demander une prolongation ».
 * Chacune peut être retirée tant que l'autre ne l'a pas aussi demandée ; rien n'est montré à
 * l'autre personne.
 */
export function DiscoveryDecisions({
  discoveryId,
  wantsToContinue,
  wantsExtension,
  canExtend,
}: {
  discoveryId: string;
  wantsToContinue: boolean;
  wantsExtension: boolean;
  canExtend: boolean;
}) {
  const t = useTranslations("Member.discoveries");
  const { error, pending, run } = useAction();
  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant={wantsToContinue ? "secondary" : "primary"}
          disabled={pending}
          aria-pressed={wantsToContinue}
          onClick={() => run(() => decideDiscovery(discoveryId, !wantsToContinue, wantsExtension))}
        >
          {wantsToContinue ? t("continueWithdraw") : t("continue")}
        </Button>
        {canExtend && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            aria-pressed={wantsExtension}
            onClick={() => run(() => decideDiscovery(discoveryId, wantsToContinue, !wantsExtension))}
          >
            {wantsExtension ? t("extendWithdraw") : t("extend")}
          </Button>
        )}
      </div>
      {canExtend && !wantsExtension && <p className="mt-3 text-sm text-fg-muted">{t("extendHint")}</p>}
      {(wantsToContinue || wantsExtension) && <p className="mt-3 text-sm text-fg-muted">{t("decisionPrivate")}</p>}
      <ErrorLine error={error} />
    </div>
  );
}
