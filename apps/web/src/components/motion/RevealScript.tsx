"use client";

import { useEffect, useState } from "react";

/**
 * Script en ligne, exécuté avant React et indépendant de son chargement.
 * - Marque la page (html[data-js]) : les éléments [data-reveal] peuvent alors être masqués.
 * - Observe ces éléments et pose data-revealed quand ils entrent à l'écran.
 * - Suit les éléments ajoutés plus tard (navigation côté client).
 * - Sécurité : sans IntersectionObserver, ou après 4 s sans initialisation, tout est révélé.
 * L'attribut data-revealed n'est pas géré par React : un nouveau rendu ne l'efface pas.
 */
const script = `(() => {
  var d = document.documentElement;
  if (!("IntersectionObserver" in window)) return;
  d.setAttribute("data-js", "");
  var safety = setTimeout(function () { d.removeAttribute("data-js"); }, 4000);
  function start() {
    clearTimeout(safety);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.setAttribute("data-revealed", ""); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    function scan(root) {
      (root.querySelectorAll ? root : document).querySelectorAll("[data-reveal]:not([data-revealed])").forEach(function (el) { io.observe(el); });
    }
    scan(document);
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.hasAttribute("data-reveal")) io.observe(n); scan(n); } }); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();`;

// Le script n'est utile qu'au premier chargement de la page. Un changement de langue
// remonte la mise en page racine côté client : React signalerait alors une balise <script>
// créée par le client. Après la première hydratation, le composant ne rend donc plus rien.
let hydrated = false;

export function RevealScript() {
  const [initial] = useState(() => !hydrated);
  useEffect(() => {
    hydrated = true;
  }, []);
  return initial ? <script dangerouslySetInnerHTML={{ __html: script }} /> : null;
}
