"use server";

import { type ApiResult, memberApi } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Réserver : place attribuée (« seat ») ou liste d'attente (« waitlist »). */
export async function bookEvening(eventId: string): Promise<ApiResult<{ outcome: "seat" | "waitlist" }>> {
  if (!UUID.test(eventId)) return { ok: false, error: "generic" };
  return memberApi(`/events/${eventId}/book`, { method: "POST" });
}

/** Confirmer sa place, jusqu'à la limite fixée par l'équipe (48 h avant par défaut). */
export async function confirmEvening(eventId: string): Promise<ApiResult<void>> {
  if (!UUID.test(eventId)) return { ok: false, error: "generic" };
  return memberApi(`/events/${eventId}/confirm`, { method: "POST" });
}

/** Annuler sa réservation ou quitter la liste d'attente. */
export async function cancelEvening(eventId: string): Promise<ApiResult<void>> {
  if (!UUID.test(eventId)) return { ok: false, error: "generic" };
  return memberApi(`/events/${eventId}/cancel`, { method: "POST" });
}

/** Payer sa soirée : l'API renvoie l'adresse de la page de paiement. */
export async function payEvening(eventId: string): Promise<ApiResult<{ paymentId: string; checkoutUrl: string }>> {
  if (!UUID.test(eventId)) return { ok: false, error: "generic" };
  return memberApi(`/payments/evenings/${eventId}`, { method: "POST" });
}

/** Copie très floutée d'un participant (aperçu avant de réserver) : lien de 5 minutes. */
export async function eveningPreviewLink(eventId: string, photoId: string): Promise<ApiResult<{ url: string }>> {
  if (!UUID.test(eventId) || !UUID.test(photoId)) return { ok: false, error: "generic" };
  const result = await memberApi<{ path: string }>(`/photos/evening/${eventId}/${photoId}/link`, { method: "POST" });
  if (!result.ok) return result;
  return { ok: true, data: { url: `${process.env.NEXT_PUBLIC_API_URL}${result.data.path}` } };
}
