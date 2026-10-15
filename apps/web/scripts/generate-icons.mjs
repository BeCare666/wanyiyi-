// Génère les icônes de l'application (PWA, favicon, Apple) à partir de l'emblème aux deux anneaux.
// Usage : node scripts/generate-icons.mjs (depuis apps/web)
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const NIGHT = "#14213D";
const IVORY = "#FAF7F2";
const ROSE_POWDER = "#E8C4C8";

/**
 * Emblème centré dans un carré de 512.
 * scale : part du carré occupée par l'emblème (plus petite pour l'icône « maskable »).
 */
function emblemSvg({ scale = 0.7, background = NIGHT, rounded = 0 } = {}) {
  const size = 512;
  const w = size * scale; // largeur de l'emblème (viewBox 100 x 60)
  const k = w / 100;
  const ox = (size - w) / 2;
  const oy = (size - 60 * k) / 2;
  const stroke = Math.max(6, 2.2 * k);
  const gap = stroke * 2.2;
  const tf = `translate(${ox} ${oy}) scale(${k})`;
  const arc = "M56.18 51.67 A22 22 0 0 1 44.72 45.83";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rounded}" fill="${background}"/>
  <g transform="${tf}" fill="none">
    <circle cx="60" cy="30" r="22" stroke="${ROSE_POWDER}" stroke-width="${stroke / k}"/>
    <circle cx="40" cy="30" r="22" stroke="${IVORY}" stroke-width="${stroke / k}"/>
    <path d="${arc}" stroke="${background}" stroke-width="${gap / k}"/>
    <path d="${arc}" stroke="${ROSE_POWDER}" stroke-width="${stroke / k}"/>
  </g>
</svg>`;
}

await mkdir("public/icons", { recursive: true });

const standard = Buffer.from(emblemSvg());
const maskable = Buffer.from(emblemSvg({ scale: 0.56 }));

await sharp(standard).resize(192).png().toFile("public/icons/icon-192.png");
await sharp(standard).resize(512).png().toFile("public/icons/icon-512.png");
await sharp(maskable).resize(512).png().toFile("public/icons/icon-maskable-512.png");
await sharp(standard).resize(180).png().toFile("src/app/apple-icon.png");
await writeFile("src/app/icon.svg", emblemSvg({ scale: 0.8, rounded: 64 }));

console.log("Icônes générées.");
