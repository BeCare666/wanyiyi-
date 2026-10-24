"use client";

import { PrinterIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

/** Ouvre l'impression du navigateur, qui propose « Enregistrer en PDF » (question 16). */
export function PrintButton() {
  const t = useTranslations("Member.myData");
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      <PrinterIcon size={18} weight="light" aria-hidden="true" />
      {t("print")}
    </Button>
  );
}
