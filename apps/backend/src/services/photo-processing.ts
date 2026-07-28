import sharp from "sharp";
import heicConvert from "heic-convert";
import { fileTypeFromBuffer } from "file-type";
import { JPEG_QUALITY, MAX_IMAGE_DIMENSION } from "../config/upload.js";
import type { PhotoWarning } from "@verkaufs-app/shared";

export type ProcessedPhoto = {
  originalName: string;
  base64: string;
  mediaType: "image/jpeg";
};

export type PhotoProcessingResult = {
  processed: ProcessedPhoto[];
  failed: PhotoWarning[];
};

const SUPPORTED_DIRECT_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  // sharp/libvips unterstützt aus Lizenzgründen nur AVIF als HEIF-Input, kein
  // HEIC (HEVC) – daher separater Decoder nur für diesen Fall.
  const jpegArrayBuffer = await heicConvert({ buffer, format: "JPEG", quality: 0.92 });
  return Buffer.from(jpegArrayBuffer);
}

async function normalizeToJpeg(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate() // EXIF-Orientierung anwenden, bevor verkleinert wird
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

async function processSinglePhoto(originalName: string, buffer: Buffer): Promise<ProcessedPhoto> {
  const detected = await fileTypeFromBuffer(buffer);
  const isHeic = detected?.mime === "image/heic" || detected?.mime === "image/heif";

  if (!isHeic && (!detected || !SUPPORTED_DIRECT_MIMES.has(detected.mime))) {
    throw new Error(
      `Nicht unterstütztes Bildformat${detected ? ` (${detected.mime})` : ""}. Bitte als JPEG, PNG oder HEIC hochladen.`
    );
  }

  const sourceBuffer = isHeic ? await convertHeicToJpeg(buffer) : buffer;
  const jpegBuffer = await normalizeToJpeg(sourceBuffer);

  return {
    originalName,
    base64: jpegBuffer.toString("base64"),
    mediaType: "image/jpeg",
  };
}

/**
 * Verarbeitet mehrere Fotos unabhängig voneinander. Ein fehlerhaftes Foto
 * (kaputte Datei, nicht unterstütztes Format, fehlerhafte HEIC-Konvertierung)
 * darf den restlichen Batch nicht blockieren (Prototyp-Erkenntnis #7).
 */
export async function processPhotos(
  files: { filename: string; buffer: Buffer }[]
): Promise<PhotoProcessingResult> {
  const processed: ProcessedPhoto[] = [];
  const failed: PhotoWarning[] = [];

  for (const file of files) {
    try {
      processed.push(await processSinglePhoto(file.filename, file.buffer));
    } catch (err) {
      failed.push({
        filename: file.filename,
        reason: err instanceof Error ? err.message : "Unbekannter Fehler bei der Bildverarbeitung.",
      });
    }
  }

  return { processed, failed };
}
