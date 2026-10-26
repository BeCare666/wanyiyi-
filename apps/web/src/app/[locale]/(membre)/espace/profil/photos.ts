/**
 * Photos du profil (section 10.2 ; question 10 de la phase 3, choix du 26 octobre 2026) :
 * 1 à 3 photos, JPEG, PNG ou WebP de 8 Mo au plus, relues par l'équipe. Mêmes limites que
 * app.add_photo (migration 20261026000700) et l'API (apps/api/src/photos/photo-image.ts).
 */

export const MAX_PHOTOS = 3;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoStatus = "pending" | "approved" | "rejected";
export type MyPhoto = { id: string; status: PhotoStatus; note: string | null };

/** Ligne de app.my_photos(). */
export type MyPhotoRow = { photo_id: string; review_status: PhotoStatus; review_note: string | null };

export function photosFrom(rows: readonly MyPhotoRow[]): MyPhoto[] {
  return rows.map((r) => ({ id: r.photo_id, status: r.review_status, note: r.review_note }));
}

/** Une photo refusée ne compte pas : elle libère une place. */
export function canAddPhoto(photos: readonly MyPhoto[]): boolean {
  return photos.filter((p) => p.status !== "rejected").length < MAX_PHOTOS;
}

export type PhotoFileError = "photo_type" | "photo_too_large";

/** Contrôle avant l'envoi (l'API refait le même contrôle). */
export function checkPhotoFile(file: { type: string; size: number }): PhotoFileError | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return "photo_type";
  if (file.size > PHOTO_MAX_BYTES) return "photo_too_large";
  return null;
}
