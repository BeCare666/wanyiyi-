import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@wanyiyi/shared"],
  // Tailwind CSS v4 via son chargeur Turbopack
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [60, 75],
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
  },
  poweredByHeader: false,
  // Le badge de développement de Next.js recouvrait la barre de navigation mobile
  // et interceptait les touchers (sélecteur de langue). Il est masqué.
  devIndicators: false,
  // Test sur téléphone via le réseau local (http://192.168.x.x:3000) : sans cette liste,
  // le serveur de développement bloque une partie de ses ressources pour ces adresses.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
};

export default withNextIntl(nextConfig);
