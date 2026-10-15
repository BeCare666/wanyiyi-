"use client";

import { motion, useReducedMotion } from "framer-motion";
import Image, { type ImageProps } from "next/image";
import { easeSoft } from "@/lib/motion";

/**
 * Image qui se rapproche très légèrement à l'apparition (transform uniquement).
 * Pas de fondu : l'image reste visible dès le premier affichage (LCP).
 */
export function SlowZoomImage({ className, alt, ...props }: ImageProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="absolute inset-0"
      initial={{ scale: reduce ? 1 : 1.06 }}
      animate={{ scale: 1 }}
      transition={{ duration: reduce ? 0 : 1.6, ease: easeSoft }}
    >
      <Image {...props} alt={alt} fill className={className} />
    </motion.div>
  );
}
