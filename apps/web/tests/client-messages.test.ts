import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_NAMESPACES, publicMessages } from "../src/i18n/client-messages";

const SRC = join(__dirname, "../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Espaces privés : leur mise en page fournit tous les textes
const PRIVATE_DIRS = [
  "app/[locale]/(admin)/admin/",
  "app/[locale]/(conseiller)/conseiller/",
  "app/[locale]/(membre)/espace/",
  "components/admin/",
  "components/counselor/",
  "components/member/",
];
const isPrivate = (path: string) => PRIVATE_DIRS.some((dir) => relative(SRC, path).replaceAll("\\", "/").startsWith(dir));

describe("textes envoyés au navigateur", () => {
  it("les pages publiques reçoivent tous les textes sauf ceux des espaces privés", () => {
    const messages = JSON.parse(readFileSync(join(__dirname, "../messages/fr.json"), "utf8"));
    const kept = publicMessages(messages);
    for (const ns of PRIVATE_NAMESPACES) expect(kept).not.toHaveProperty(ns);
    expect(Object.keys(kept)).toEqual(Object.keys(messages).filter((k) => !(PRIVATE_NAMESPACES as readonly string[]).includes(k)));
  });

  it("un composant du navigateur qui lit des textes privés n'est utilisé que dans les espaces privés", () => {
    const all = files(SRC);
    const code = new Map(all.map((file) => [file, readFileSync(file, "utf8")]));
    const privateNs = new RegExp(`useTranslations\\("(${PRIVATE_NAMESPACES.join("|")})[".]`);
    const offenders: string[] = [];
    let checked = 0;
    for (const file of all) {
      const source = code.get(file)!;
      if (!/^"use client"/.test(source) || !privateNs.test(source)) continue;
      checked += 1;
      if (!isPrivate(file)) {
        offenders.push(relative(SRC, file));
        continue;
      }
      const name = file.replace(/\.tsx?$/, "").split(/[\\/]/).pop()!;
      const imported = new RegExp(`from "[^"]*/${name}"`);
      for (const importer of all) {
        if (importer === file || isPrivate(importer)) continue;
        if (imported.test(code.get(importer)!)) offenders.push(`${relative(SRC, importer)} -> ${name}`);
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  }, 60_000);
});
