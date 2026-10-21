import type { MetadataRoute } from "next";

/** Manifeste de l'application installable (PWA). La langue source est le français. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ifedele · Rencontres sérieuses à Cotonou",
    short_name: "Ifedele",
    description: "Des rencontres vérifiées, en face à face, accompagnées jusqu'à l'union.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f2",
    theme_color: "#14213d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
