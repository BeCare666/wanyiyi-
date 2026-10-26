"use client";

import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { deleteFilter } from "@/app/[locale]/(admin)/admin/membres/actions";
import { dateRange, dateShortcuts } from "@/app/[locale]/(admin)/admin/membres/filters";
import { Button, fieldClass } from "@/components/ui/Button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { saveListFilter } from "./listFilterActions";
import {
  BUILDER_MAX_CONDITIONS,
  emptyListCondition,
  type ListCondition,
  type ListGroup,
  type ListName,
  type ListNode,
  type ListSortKey,
  listConditionCount,
  listFilterQuery,
  listSpecs,
  NUMBER_MAX,
  pruneListFilter,
} from "./listRules";

export type SavedListFilter = { id: string; name: string; shared: boolean; mine: boolean; query: Record<string, string> };

type Props = {
  list: ListName;
  /** Filtres rapides en cours, gardés quand on applique le filtre avancé. */
  quick: Record<string, string>;
  filter: ListGroup | null;
  sort: ListSortKey[];
  columns: string[];
  saved: SavedListFilter[];
};

const smallField = cn(fieldClass, "mt-1 py-2 text-base");
const isGroup = (node: ListNode): node is ListGroup => "op" in node;

/**
 * Filtres avancés d'une liste de l'administration (section 11.3) : constructeur ET / OU avec un
 * niveau de sous-groupes, tri sur 3 colonnes, choix des colonnes, filtres enregistrés et partagés.
 * Mêmes gestes que la liste des membres ; tout est reflété dans l'adresse.
 */
export function ListFilters({ list, quick, filter, sort, columns, saved }: Props) {
  const t = useTranslations("Admin.members.advanced");
  const tl = useTranslations(`Admin.lists.${list}`);
  const spec = listSpecs[list];
  const router = useRouter();
  const [draft, setDraft] = useState<ListGroup>(filter ?? { op: "and", items: [] });
  const [sortDraft, setSortDraft] = useState<ListSortKey[]>(sort);
  const [columnsDraft, setColumnsDraft] = useState<string[]>(columns);
  const full = listConditionCount(draft) >= BUILDER_MAX_CONDITIONS;

  const apply = (e: FormEvent) => {
    e.preventDefault();
    router.push({ pathname: spec.pathname, query: listFilterQuery(spec, quick, pruneListFilter(spec, draft), sortDraft, columnsDraft) });
  };

  return (
    <details open={filter !== null || sort.length > 0} className="mt-8 border-t border-line pt-6">
      <summary className="cursor-pointer text-sm font-medium">{t("title")}</summary>
      <form onSubmit={apply} className="mt-6 space-y-10">
        <fieldset>
          <legend className="text-sm font-medium">{t("conditions")}</legend>
          <p className="mt-1 text-xs text-fg-muted">{t("conditionsHelp", { max: BUILDER_MAX_CONDITIONS })}</p>
          <GroupEditor list={list} group={draft} root full={full} onChange={setDraft} />
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">{t("sort")}</legend>
          <div className="mt-2 grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => {
              const key = sortDraft[i];
              const used = new Set(sortDraft.filter((_, j) => j !== i).map((s) => s.field));
              return (
                <div key={i} className="flex gap-2">
                  <label className="block flex-1">
                    <span className="sr-only">{t("sortField", { rank: i + 1 })}</span>
                    <select
                      value={key?.field ?? ""}
                      disabled={i > sortDraft.length}
                      onChange={(e) => {
                        const field = e.target.value;
                        setSortDraft((s) => (field === "" ? s.slice(0, i) : [...s.slice(0, i), { field, dir: s[i]?.dir ?? "asc" }, ...s.slice(i + 1)]));
                      }}
                      className={smallField}
                    >
                      <option value="">{i === 0 ? tl("sortDefault") : t("sortNone")}</option>
                      {spec.sortFields.map((f) => (
                        <option key={f} value={f} disabled={used.has(f)}>
                          {tl(`fields.${f}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {key && (
                    <label className="block">
                      <span className="sr-only">{t("sortDirection", { rank: i + 1 })}</span>
                      <select
                        value={key.dir}
                        onChange={(e) => setSortDraft((s) => s.map((x, j) => (j === i ? { ...x, dir: e.target.value as "asc" | "desc" } : x)))}
                        className={smallField}
                      >
                        <option value="asc">{t("asc")}</option>
                        <option value="desc">{t("desc")}</option>
                      </select>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">{t("columns")}</legend>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
            {spec.columns.map((c) => (
              <label key={c} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={columnsDraft.includes(c)}
                  onChange={(e) => setColumnsDraft((cols) => spec.columns.filter((x) => (x === c ? e.target.checked : cols.includes(x))))}
                />
                {tl(`columns.${c}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <Button type="submit">{t("apply")}</Button>
          <Link href={{ pathname: spec.pathname, query: quick }} className="inline-flex min-h-12 items-center px-2 text-sm text-link underline-offset-4 hover:underline">
            {t("reset")}
          </Link>
        </div>
      </form>

      <SavedFilters list={list} saved={saved} current={{ filter: filter ?? { op: "and", items: [] }, sort, columns }} />
    </details>
  );
}

function GroupEditor({
  list,
  group,
  root = false,
  full,
  onChange,
  onRemove,
}: {
  list: ListName;
  group: ListGroup;
  root?: boolean;
  full: boolean;
  onChange: (g: ListGroup) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("Admin.members.advanced");
  const tc = useTranslations("Admin.lists");
  const firstField = Object.keys(listSpecs[list].fields)[0]!;
  const setItem = (i: number, node: ListNode) => onChange({ ...group, items: group.items.map((x, j) => (j === i ? node : x)) });
  const removeItem = (i: number) => onChange({ ...group, items: group.items.filter((_, j) => j !== i) });

  return (
    <div className={cn("mt-4 space-y-4", !root && "border-l border-line-strong pl-4")}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="block">
          <span className="sr-only">{t("operator")}</span>
          <select value={group.op} onChange={(e) => onChange({ ...group, op: e.target.value as "and" | "or" })} className={cn(smallField, "mt-0")}>
            <option value="and">{t("and")}</option>
            <option value="or">{t("or")}</option>
          </select>
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} className="inline-flex min-h-10 items-center gap-2 text-sm text-fg-muted hover:text-fg">
            <TrashIcon size={16} weight="light" aria-hidden="true" />
            {t("removeGroup")}
          </button>
        )}
      </div>

      {group.items.length === 0 && <p className="text-sm text-fg-muted">{tc("empty")}</p>}
      <ul className="space-y-4">
        {group.items.map((item, i) => (
          <li key={i}>
            {isGroup(item) ? (
              <GroupEditor list={list} group={item} full={full} onChange={(g) => setItem(i, g)} onRemove={() => removeItem(i)} />
            ) : (
              <ConditionEditor list={list} condition={item} onChange={(c) => setItem(i, c)} onRemove={() => removeItem(i)} />
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-4">
        <button
          type="button"
          disabled={full}
          onClick={() => onChange({ ...group, items: [...group.items, emptyListCondition(listSpecs[list], firstField)] })}
          className="inline-flex min-h-10 items-center gap-2 text-sm text-link disabled:opacity-50"
        >
          <PlusIcon size={16} weight="light" aria-hidden="true" />
          {t("addCondition")}
        </button>
        {root && (
          <button
            type="button"
            disabled={full}
            onClick={() =>
              onChange({ ...group, items: [...group.items, { op: group.op === "and" ? "or" : "and", items: [emptyListCondition(listSpecs[list], firstField)] }] })
            }
            className="inline-flex min-h-10 items-center gap-2 text-sm text-link disabled:opacity-50"
          >
            <PlusIcon size={16} weight="light" aria-hidden="true" />
            {t("addGroup")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Une condition : champ, puis la saisie adaptée à son type. */
function ConditionEditor({ list, condition, onChange, onRemove }: { list: ListName; condition: ListCondition; onChange: (c: ListCondition) => void; onRemove: () => void }) {
  const t = useTranslations("Admin");
  const ta = useTranslations("Admin.members.advanced");
  const tl = useTranslations(`Admin.lists.${list}`);
  const spec = listSpecs[list];
  const field = spec.fields[condition.field]!;

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-start">
      <label className="block">
        <span className="sr-only">{ta("field")}</span>
        <select value={condition.field} onChange={(e) => onChange(emptyListCondition(spec, e.target.value))} className={smallField}>
          {Object.keys(spec.fields).map((f) => (
            <option key={f} value={f}>
              {tl(`fields.${f}`)}
            </option>
          ))}
        </select>
      </label>

      <div>
        {field.kind === "text" && condition.cmp === "contains" && (
          <label className="block">
            <span className="sr-only">{ta("contains")}</span>
            <input
              type="text"
              value={condition.value}
              maxLength={100}
              placeholder={ta("contains")}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              className={smallField}
            />
          </label>
        )}

        {field.kind === "list" && condition.cmp === "in" && (
          <fieldset className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            <legend className="sr-only">{tl(`fields.${condition.field}`)}</legend>
            {(field.options ?? []).map((v) => (
              <label key={v} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={condition.value.includes(v)}
                  onChange={(e) => onChange({ ...condition, value: e.target.checked ? [...condition.value, v] : condition.value.filter((x) => x !== v) })}
                />
                {t(`${field.labels}.${v}`)}
              </label>
            ))}
          </fieldset>
        )}

        {field.kind === "number" && condition.cmp === "between" && (
          <div className="grid grid-cols-2 gap-3">
            {(["min", "max"] as const).map((bound, i) => (
              <label key={bound} className="block">
                <span className="text-xs text-fg-muted">{ta(bound)}</span>
                <input
                  type="number"
                  min={0}
                  max={NUMBER_MAX}
                  step={1}
                  value={condition.value[i] ?? ""}
                  onChange={(e) => {
                    const n = e.target.value === "" ? null : Math.trunc(e.target.valueAsNumber);
                    const value = [...condition.value] as [number | null, number | null];
                    value[i] = n === null || Number.isNaN(n) ? null : n;
                    onChange({ field: condition.field, cmp: "between", value });
                  }}
                  className={cn(smallField, "tabular-nums")}
                />
              </label>
            ))}
          </div>
        )}

        {field.kind === "date" && condition.cmp === "between" && (
          <div>
            <div className="grid grid-cols-2 gap-3">
              {(["from", "to"] as const).map((bound, i) => (
                <label key={bound} className="block">
                  <span className="text-xs text-fg-muted">{ta(bound)}</span>
                  <input
                    type="date"
                    value={(condition.value[i] as string | null) ?? ""}
                    onChange={(e) => {
                      const value = [...condition.value] as [string | null, string | null];
                      value[i] = e.target.value || null;
                      onChange({ field: condition.field, cmp: "between", value });
                    }}
                    className={smallField}
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-4">
              {dateShortcuts.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange({ field: condition.field, cmp: "between", value: dateRange(s, new Date()) })}
                  className="text-xs text-link underline-offset-4 hover:underline"
                >
                  {ta(`shortcuts.${s}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {field.kind === "boolean" && condition.cmp === "is" && (
          <label className="block">
            <span className="sr-only">{tl(`fields.${condition.field}`)}</span>
            <select value={condition.value ? "yes" : "no"} onChange={(e) => onChange({ ...condition, value: e.target.value === "yes" })} className={smallField}>
              <option value="yes">{ta("yes")}</option>
              <option value="no">{ta("no")}</option>
            </select>
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={ta("removeCondition")}
        className="inline-flex size-10 items-center justify-center rounded-sm text-fg-muted hover:text-fg md:mt-1"
      >
        <TrashIcon size={18} weight="light" />
      </button>
    </div>
  );
}

/** Filtres enregistrés de la liste : les siens et ceux que l'équipe a partagés. */
function SavedFilters({ list, saved, current }: { list: ListName; saved: SavedListFilter[]; current: { filter: ListGroup; sort: ListSortKey[]; columns: string[] } }) {
  const t = useTranslations("Admin.members.advanced");
  const router = useRouter();
  const spec = listSpecs[list];
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const known = new Set(["name_required", "invalid_filter", "forbidden", "unavailable"]);

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) => {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(known.has(result.error) ? result.error : "generic");
      after?.();
      router.refresh();
    });
  };

  return (
    <section aria-labelledby={`filtres-enregistres-${list}`} className="mt-10 border-t border-line pt-6">
      <h2 id={`filtres-enregistres-${list}`} className="text-sm font-medium">
        {t("saved")}
      </h2>
      {saved.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">{t("savedEmpty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
          {saved.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <Link href={{ pathname: spec.pathname, query: s.query }} className="text-link underline-offset-4 hover:underline">
                {s.name}
              </Link>
              <span className="flex items-center gap-3 text-xs text-fg-muted">
                {s.shared ? t("sharedBadge") : t("privateBadge")}
                {s.mine && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteFilter(s.id))}
                    aria-label={t("deleteSaved", { name: s.name })}
                    className="inline-flex size-9 items-center justify-center rounded-sm hover:text-fg"
                  >
                    <TrashIcon size={16} weight="light" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveListFilter(list, { name, shared, definition: current.filter, sort: current.sort, columns: current.columns }), () => {
            setName("");
            setDone(true);
          });
        }}
        className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end"
      >
        <label className="block">
          <span className="text-sm">{t("saveName")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("saveHelp")}</span>
          <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={smallField} />
        </label>
        <label className="inline-flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          {t("share")}
        </label>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t("save")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-4 border-l border-accent pl-5 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
      {done && (
        <p role="status" className="mt-4 text-sm text-fg-muted">
          {t("savedDone")}
        </p>
      )}
    </section>
  );
}
