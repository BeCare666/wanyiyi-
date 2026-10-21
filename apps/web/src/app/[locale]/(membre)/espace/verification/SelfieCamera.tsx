"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

/** Plus grand côté de la photo enregistrée, en pixels (suffisant pour comparer le visage à la pièce). */
const MAX_SIDE = 1280;

type CameraError = "noCamera" | "denied" | "failed";

/**
 * Selfie pris en direct avec la caméra frontale (décision du 21 octobre 2026) :
 * aucun dépôt de fichier possible. Sans caméra, le membre est invité à utiliser un téléphone.
 * L'aperçu est en miroir (plus naturel) ; la photo enregistrée ne l'est pas.
 */
export function SelfieCamera({ onCapture }: { onCapture: (file: File | undefined) => void }) {
  const t = useTranslations("Member.verification.documents.camera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<CameraError | null>(null);

  function stop() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLive(false);
  }

  useEffect(() => stop, []);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function open() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) return setError("noCamera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      setLive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e) {
      stop();
      const name = e instanceof DOMException ? e.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "noCamera" : "failed");
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        stop();
        if (!blob) return setError("failed");
        setPreview(URL.createObjectURL(blob));
        onCapture(new File([blob], "selfie.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  }

  function retake() {
    setPreview(null);
    onCapture(undefined);
    void open();
  }

  return (
    <div className="mt-3">
      {/* Toujours présente pour que open() puisse y brancher la caméra */}
      <video
        ref={videoRef}
        playsInline
        muted
        aria-label={t("live")}
        className={live ? "aspect-[3/4] w-full max-w-xs -scale-x-100 rounded-sm bg-bg-soft object-cover" : "hidden"}
      />
      {preview && !live && (
        // eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob), jamais envoyé ailleurs
        <img src={preview} alt={t("taken")} className="aspect-[3/4] w-full max-w-xs rounded-sm object-cover" />
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        {live ? (
          <>
            <Button type="button" onClick={capture}>
              {t("capture")}
            </Button>
            <Button type="button" variant="secondary" onClick={stop}>
              {t("cancel")}
            </Button>
          </>
        ) : preview ? (
          <Button type="button" variant="secondary" onClick={retake}>
            {t("retake")}
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={open}>
            {t("open")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 border-l border-accent pl-5 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
