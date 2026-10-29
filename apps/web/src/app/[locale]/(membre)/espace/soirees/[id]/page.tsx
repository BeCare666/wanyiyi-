import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { memberNav } from "@/components/member/memberNav";
import { ProtectedPhoto } from "@/components/ui/ProtectedPhoto";
import { Link } from "@/i18n/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { eveningPreviewLink } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Participant = {
  user_id: string;
  first_name: string;
  age: number;
  city: string | null;
  sector: string | null;
  religion: string | null;
  texts: { field: string; body: string }[];
  photo_id: string | null;
};

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.evenings.participants");
  return { title: t("title") };
}

/**
 * Inscrits de l'autre sexe d'une soirée, avant de réserver (décision du 29 octobre 2026) :
 * prénom, âge, ville, secteur, religion, textes relus, photo très floutée (visage illisible).
 * Lu avec le jeton du membre (app.evening_participants : membre vérifié, soirée publiée à venir,
 * membres qui ont choisi de ne pas apparaître exclus). La photo nette reste réservée au match.
 */
export default async function EveningParticipantsPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("Member.evenings");
  const tProfile = await getTranslations("Profile");
  const tTexts = await getTranslations("Member.profile.texts.fields");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  if (!supabase) notFound();

  const [eventResult, participantsResult] = await Promise.all([
    supabase.from("events").select("id, starts_at").eq("id", id).maybeSingle(),
    supabase.rpc("evening_participants", { p_event: id }),
  ]);
  const event = eventResult.data as { id: string; starts_at: string } | null;
  if (!event) notFound();
  const error = participantsResult.error?.message ?? null;
  const participants = (participantsResult.data ?? []) as Participant[];
  const startsAt = new Date(event.starts_at);
  const option = (category: "sector" | "religion", value: string | null) =>
    value && tProfile.has(`${category}.options.${value}`) ? tProfile(`${category}.options.${value}`) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={memberNav.evenings.href} className="text-sm text-link underline-offset-4 hover:underline">
        {t("participants.back")}
      </Link>
      <header className="mt-6">
        <p className="eyebrow first-letter:uppercase">
          {format.dateTime(startsAt, "eventDay")} · {format.dateTime(startsAt, "eventTime")}
        </p>
        <h1 className="mt-4 text-4xl">{t("participants.title")}</h1>
        <p className="mt-6 max-w-measure text-fg-muted">{t("participants.intro")}</p>
      </header>

      {error ? (
        <p role="alert" className="mt-12 border-l border-accent pl-5 text-fg-muted">
          {t(error === "not_validated" ? "participants.notVerified" : error === "evening_closed" ? "participants.closed" : "errors.generic")}
        </p>
      ) : participants.length === 0 ? (
        <p className="mt-12 border-t border-line pt-8 text-fg-muted">{t("participants.empty")}</p>
      ) : (
        <ul className="mt-12 grid gap-10 border-t border-line pt-10 sm:grid-cols-2 lg:grid-cols-3">
          {participants.map((p) => {
            const facts = [t("participants.age", { age: p.age }), p.city, option("sector", p.sector), option("religion", p.religion)].filter(Boolean);
            return (
              <li key={p.user_id}>
                <div className="max-w-xs">
                  {p.photo_id ? (
                    <ProtectedPhoto load={eveningPreviewLink.bind(null, event.id, p.photo_id)} alt={t("participants.photoAlt", { name: p.first_name })} />
                  ) : (
                    <p className="text-sm text-fg-muted">{t("participants.noPhoto")}</p>
                  )}
                </div>
                <h2 className="mt-4 font-serif text-2xl">{p.first_name}</h2>
                <p className="mt-1 text-sm text-fg-muted">{facts.join(" · ")}</p>
                {p.texts.map((text) => (
                  <div key={text.field} className="mt-4 text-sm">
                    <p className="text-fg-muted">{tTexts(text.field)}</p>
                    <p className="mt-1 whitespace-pre-line">{text.body}</p>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
