// Génère le projet Android (Trusted Web Activity) d'Ifedele à partir du manifeste du site.
// Usage (depuis la racine du dépôt) : node android/generer-projet.cjs
// Bubblewrap doit être installé dans %USERPROFILE%\.bubblewrap\cli (déjà le cas sur ce poste).
const path = require("node:path");
const os = require("node:os");

const core = require(path.join(os.homedir(), ".bubblewrap", "cli", "node_modules", "@bubblewrap", "core"));
const { TwaManifest, TwaGenerator, ConsoleLog } = core;

const SITE = "https://ifedele.com";
const DOSSIER = path.join(__dirname, "projet");

async function main() {
  const manifeste = await TwaManifest.fromWebManifest(`${SITE}/manifest.webmanifest`);
  const json = manifeste.toJson();
  Object.assign(json, {
    packageId: "com.ifedele.app",
    host: "ifedele.com",
    name: "Ifedele",
    launcherName: "Ifedele",
    startUrl: "/",
    display: "standalone",
    orientation: "portrait",
    themeColor: "#14213D",
    themeColorDark: "#14213D",
    navigationColor: "#14213D",
    navigationColorDark: "#14213D",
    navigationDividerColor: "#14213D",
    navigationDividerColorDark: "#14213D",
    backgroundColor: "#FAF7F2",
    enableNotifications: false,
    appVersionCode: 1,
    minSdkVersion: 24, // exigé par androidbrowserhelper 2.7.4 (Android 7.0)
    appVersionName: "1.0.0",
    fallbackType: "customtabs",
    signingKey: {
      path: path.join(os.homedir(), "ifedele-signature", "ifedele.keystore"),
      alias: "ifedele",
    },
    generatorApp: "bubblewrap-cli",
  });
  const twa = new TwaManifest(json);
  const erreur = twa.validate();
  if (erreur) throw new Error(erreur);
  const log = new ConsoleLog("ifedele");
  await new TwaGenerator().createTwaProject(DOSSIER, twa, log);
  await twa.saveToFile(path.join(DOSSIER, "twa-manifest.json"));
  console.log(`Projet Android généré dans ${DOSSIER}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
