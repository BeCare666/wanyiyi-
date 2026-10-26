import type { EventStatus } from "./evenings";

/**
 * Composition assistée (section 11.2-5 de la note) : critères non négociables incompatibles entre
 * deux participants de sexe opposé, ligne de app.event_composition_alerts.
 */
export type CompositionAlert = {
  holder_id: string;
  holder_number: string | null;
  holder_first_name: string | null;
  holder_sex: "female" | "male";
  other_id: string;
  other_number: string | null;
  other_first_name: string | null;
  category: string;
  sought: string[];
  declared: string[] | null;
  /** incompatible : la réponse de l'autre n'est pas dans la recherche ; unknown : l'autre n'a pas répondu. */
  kind: "incompatible" | "unknown";
};

/** Alertes utiles tant que la soirée peut encore être composée (publiée, complète ou en cours). */
export function showComposition(status: EventStatus): boolean {
  return status === "published" || status === "full" || status === "in_progress";
}

/** Incompatibilités d'abord, puis les réponses manquantes à vérifier. */
export function splitAlerts(alerts: CompositionAlert[]): Record<CompositionAlert["kind"], CompositionAlert[]> {
  return {
    incompatible: alerts.filter((a) => a.kind === "incompatible"),
    unknown: alerts.filter((a) => a.kind === "unknown"),
  };
}

/** Participants concernés par au moins une incompatibilité (à regarder avant la soirée). */
export function involvedCount(alerts: CompositionAlert[]): number {
  return new Set(alerts.filter((a) => a.kind === "incompatible").flatMap((a) => [a.holder_id, a.other_id])).size;
}
