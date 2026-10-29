import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";

/**
 * Données fictives pour les tests : prénoms béninois, aucune personne réelle.
 * Insertion directe (accès base), comme le ferait un script d'amorçage.
 */

export type Sex = "female" | "male";

export type MemberInput = {
  firstName: string;
  sex: Sex;
  birthDate?: string;
  status?: "registering" | "pending_verification" | "to_correct" | "verified";
  role?: "member" | "counselor" | "moderator" | "admin" | "super_admin";
  religion?: string;
  sector?: string;
  /** Photo approuvée, exigée pour réserver une soirée (question 10 c). */
  photo?: boolean;
};

let phoneCounter = 0;

export async function createMember(db: PGlite, input: MemberInput): Promise<string> {
  const id = randomUUID();
  phoneCounter += 1;
  await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `+22901970${String(phoneCounter).padStart(5, "0")}`]);
  if (input.role && input.role !== "member") {
    await db.query("update app.users set role = $2 where id = $1", [id, input.role]);
  }
  await db.query(
    `insert into app.member_profiles (user_id, first_name, last_name, sex, birth_date, city, status)
     values ($1, $2, 'Fictif', $3, $4, 'Cotonou', $5)`,
    [id, input.firstName, input.sex, input.birthDate ?? "1994-05-14", input.status ?? "verified"],
  );
  if (input.religion) {
    await db.query("insert into app.profile_answers (user_id, side, category, \"values\") values ($1, 'self', 'religion', $2)", [
      id,
      [input.religion],
    ]);
  }
  if (input.sector) {
    await db.query("insert into app.profile_answers (user_id, side, category, \"values\") values ($1, 'self', 'sector', $2)", [
      id,
      [input.sector],
    ]);
  }
  if (input.photo) {
    await db.query("insert into app.photos (user_id, storage_path, review_status) values ($1, $2, 'approved')", [id, `${id}/photo.jpg`]);
  }
  return id;
}

export type EventInput = {
  /** Décalage du début par rapport à maintenant, en heures (négatif : soirée commencée). */
  startsInHours: number;
  capacityWomen?: number;
  capacityMen?: number;
  status?: "draft" | "published" | "in_progress" | "finished";
  theme?: { minAge?: number; maxAge?: number; religions?: string[]; sectors?: string[] };
};

export async function createVenue(db: PGlite): Promise<string> {
  // Lieu fictif pour la démonstration
  const { rows } = await db.query<{ id: string }>(
    "insert into app.venues (name, address, city, is_partner) values ('Maison Akpakpa (lieu fictif)', 'Adresse fictive, Cotonou', 'Cotonou', true) returning id",
  );
  return rows[0]!.id;
}

export async function createEvent(db: PGlite, input: EventInput): Promise<string> {
  let themeId: string | null = null;
  if (input.theme) {
    const { rows } = await db.query<{ id: string }>(
      "insert into app.themes (key, min_age, max_age, required_religions, sectors) values ($1, $2, $3, $4, $5) returning id",
      [`theme-${randomUUID()}`, input.theme.minAge ?? null, input.theme.maxAge ?? null, input.theme.religions ?? null, input.theme.sectors ?? null],
    );
    themeId = rows[0]!.id;
  }
  const venueId = await createVenue(db);
  const { rows } = await db.query<{ id: string }>(
    `insert into app.events (venue_id, theme_id, starts_at, capacity_women, capacity_men, status, price_xof)
     values ($1, $2, now() + make_interval(secs => $3::float8 * 3600), $4, $5, $6, null) returning id`,
    [venueId, themeId, input.startsInHours, input.capacityWomen ?? 10, input.capacityMen ?? 10, input.status ?? "published"],
  );
  return rows[0]!.id;
}

/** Inscription directe (accès base), par exemple pour préparer une soirée déjà pleine. */
export async function register(db: PGlite, eventId: string, userId: string, sex: Sex, status: string, seatedHoursAgo = 0) {
  await db.query(
    `insert into app.event_registrations (event_id, user_id, sex, status, seated_at, checked_in_at)
     values ($1, $2, $3, $4::app.registration_status, now() - make_interval(secs => $5::float8 * 3600),
             case when $4::text = 'checked_in' then now() else null end)`,
    [eventId, userId, sex, status, seatedHoursAgo],
  );
}
