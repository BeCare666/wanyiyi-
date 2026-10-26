import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { type MyPhotoRow, photosFrom } from "./photos";
import { PhotosStep } from "./PhotosStep";
import { answersFrom } from "./profile";
import { ProfileEditor } from "./ProfileEditor";
import type { ProfileText } from "./TextsStep";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.profile");
  return { title: t("title") };
}

/**
 * Mon profil (section 6.2-3 et section 8) : « Je me décris » et « Ce que je recherche ».
 * Lecture avec le jeton du membre (RLS : ses propres lignes seulement). Mes photos : phase 3,
 * question 10.
 */
export default async function ProfilePage() {
  const t = await getTranslations("Member");
  const member = await getSessionMember();
  if (!member) return null;
  const supabase = await createSupabaseServer();
  const [answers, dealbreakers, texts, photos] = await Promise.all([
    supabase?.from("profile_answers").select("side, category, values"),
    supabase?.from("dealbreakers").select("category"),
    supabase?.from("profile_texts").select("field, body, review_status, review_note"),
    supabase?.rpc("my_photos"),
  ]);
  const textRows = (texts?.data ?? []) as { field: string; body: string; review_status: ProfileText["status"]; review_note: string | null }[];

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("nav.profile")}
        </p>
        <h1 className="mt-6 text-4xl">{t("profile.title")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("profile.intro")}</p>
      </header>
      {!member.firstName ? (
        <p className="mt-10 border-l border-accent pl-5">
          {t("profile.noProfile")}{" "}
          <Link href="/inscription" className="text-link underline underline-offset-4">
            {t("profile.finishRegistration")}
          </Link>
        </p>
      ) : !supabase || answers?.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("profile.unavailable")}
        </p>
      ) : (
        <ProfileEditor
          initialAnswers={answersFrom((answers?.data ?? []) as { side: string; category: string; values: string[] }[])}
          initialDealbreakers={((dealbreakers?.data ?? []) as { category: string }[]).map((d) => d.category)}
          texts={Object.fromEntries(textRows.map((r) => [r.field, { body: r.body, status: r.review_status, note: r.review_note }]))}
        />
      )}
      {member.firstName && supabase && !photos?.error && (
        <PhotosStep photos={photosFrom((photos?.data ?? []) as MyPhotoRow[])} />
      )}
    </div>
  );
}
