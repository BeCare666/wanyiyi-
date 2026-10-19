"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { toCotonouInput } from "../../soirees/evenings";
import { blockEvenings, excludeMember, reactivateMember, setRole, suspendMember } from "../actions";
import { type Role, roles } from "../members";

const knownErrors = new Set([
  "reason_required",
  "self_action",
  "invalid_status",
  "profile_missing",
  "date_in_past",
  "date_invalid",
  "not_found",
  "forbidden",
  "unavailable",
]);

type Result = { ok: true } | { ok: false; error: string };

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>, after?: () => void) => {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setDone(true);
      after?.();
      router.refresh();
    });
  };
  return { error, done, pending, run, setError };
}

function Feedback({ error, done }: { error: string | null; done: boolean }) {
  const t = useTranslations("Admin.members.actions");
  if (error)
    return (
      <p role="alert" className="mt-4 border-l border-accent pl-5">
        {t(`errors.${error}`)}
      </p>
    );
  if (done)
    return (
      <p role="status" className="mt-4 text-sm text-fg-muted">
        {t("done")}
      </p>
    );
  return null;
}

/**
 * Suspension ou exclusion : motif obligatoire, lu par le membre dans sa notification.
 * L'exclusion, définitive, demande une seconde confirmation.
 */
export function SanctionForm({ userId, kind }: { userId: string; kind: "suspend" | "exclude" }) {
  const t = useTranslations("Admin.members.actions");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { error, done, pending, run, setError } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (reason.trim() === "") return setError("reason_required");
    if (kind === "exclude" && !confirming) return setConfirming(true);
    setConfirming(false);
    run(() => (kind === "suspend" ? suspendMember(userId, reason) : excludeMember(userId, reason)), () => setReason(""));
  }

  return (
    <form onSubmit={submit} noValidate>
      <label className="block">
        <span className="text-sm font-medium">{t(`${kind}.reason`)}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t("reasonHelp")}</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} className={cn(fieldClass, "resize-y text-base")} />
      </label>
      {confirming && (
        <p role="alert" className="mt-4 border-l border-accent pl-5">
          {t("exclude.confirm")}
        </p>
      )}
      <Feedback error={error} done={done} />
      <Button type="submit" variant={kind === "exclude" ? "primary" : "secondary"} disabled={pending} className="mt-6">
        {confirming ? t("exclude.confirmButton") : t(`${kind}.button`)}
      </Button>
    </form>
  );
}

export function ReactivateButton({ userId }: { userId: string }) {
  const t = useTranslations("Admin.members.actions");
  const { error, done, pending, run } = useAction();
  return (
    <div>
      <p className="text-fg-muted">{t("reactivate.help")}</p>
      <Feedback error={error} done={done} />
      <Button type="button" disabled={pending} className="mt-6" onClick={() => run(() => reactivateMember(userId))}>
        {t("reactivate.button")}
      </Button>
    </div>
  );
}

/** Blocage des soirées jusqu'à une date (heure de Cotonou), ou levée du blocage. */
export function BlockEveningsForm({ userId, blockedUntil }: { userId: string; blockedUntil: string | null }) {
  const t = useTranslations("Admin.members.actions");
  // blockedUntil : blocage en cours seulement (calculé par la page), sinon null
  const active = blockedUntil !== null;
  const [until, setUntil] = useState(blockedUntil ? toCotonouInput(new Date(blockedUntil)) : "");
  const { error, done, pending, run, setError } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (until.trim() === "") return setError("date_invalid");
    run(() => blockEvenings(userId, until));
  }

  return (
    <form onSubmit={submit} noValidate>
      <label className="block max-w-sm">
        <span className="text-sm font-medium">{t("block.until")}</span>
        <span className="mt-1 block text-xs text-fg-muted">{t("block.help")}</span>
        <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className={cn(fieldClass, "text-base")} />
      </label>
      <Feedback error={error} done={done} />
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {t("block.button")}
        </Button>
        {active && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setUntil("");
              run(() => blockEvenings(userId, ""));
            }}
          >
            {t("block.lift")}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Changement de rôle (super administration), avec seconde confirmation. */
export function RoleForm({ userId, current }: { userId: string; current: Role }) {
  const t = useTranslations("Admin.members");
  const [role, setRoleValue] = useState<Role>(current);
  const [confirming, setConfirming] = useState(false);
  const { error, done, pending, run } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (role === current) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    run(() => setRole(userId, role));
  }

  return (
    <form onSubmit={submit} noValidate>
      <label className="block max-w-sm">
        <span className="text-sm font-medium">{t("columns.role")}</span>
        <select
          value={role}
          onChange={(e) => {
            setRoleValue(e.target.value as Role);
            setConfirming(false);
          }}
          className={cn(fieldClass, "text-base")}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </select>
      </label>
      {confirming && (
        <p role="alert" className="mt-4 border-l border-accent pl-5">
          {t("actions.role.confirm", { role: t(`roles.${role}`) })}
        </p>
      )}
      <Feedback error={error} done={done} />
      <Button type="submit" variant="secondary" disabled={pending || role === current} className="mt-6">
        {confirming ? t("actions.role.confirmButton") : t("actions.role.button")}
      </Button>
    </form>
  );
}
