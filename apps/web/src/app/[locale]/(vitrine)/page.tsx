import { Celebration } from "@/components/sections/Celebration";
import { Evenings } from "@/components/sections/Evenings";
import { Faq } from "@/components/sections/Faq";
import { Hero } from "@/components/sections/Hero";
import { Journey } from "@/components/sections/Journey";
import { PromiseSection } from "@/components/sections/PromiseSection";
import { Safety } from "@/components/sections/Safety";
import { Support } from "@/components/sections/Support";
import { Testimonials } from "@/components/sections/Testimonials";
import { Upcoming } from "@/components/sections/Upcoming";

/** Page vitrine : sections dans l'ordre exact de la section 5 de la note. */
export default async function HomePage() {
  return (
    <>
      <Hero />
      <PromiseSection />
      <Journey />
      <Evenings />
      <Safety />
      <Support />
      <Celebration />
      <Testimonials />
      <Upcoming />
      <Faq />
    </>
  );
}
