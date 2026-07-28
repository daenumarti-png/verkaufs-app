import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

let client: ReturnType<typeof createClient> | undefined;

function getClient() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase Storage ist nicht konfiguriert (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen).");
  }
  // service_role-Key umgeht Row Level Security – ausschliesslich serverseitig
  // verwenden, nie an den Client weitergeben (siehe env.ts-Kommentar).
  client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return client;
}

export type UploadedPhoto = {
  url: string;
  path: string;
};

/**
 * Lädt ein Foto in den öffentlichen Supabase-Storage-Bucket hoch und gibt
 * die dauerhafte öffentliche URL zurück. Wird u.a. für die eBay-Anbindung
 * gebraucht (Phase 12) – eBays API verlangt echte Bild-URLs, keine Base64-Daten.
 */
export async function uploadPhotoToStorage(buffer: Buffer, contentType: string): Promise<UploadedPhoto> {
  const extension = contentType === "image/png" ? "png" : "jpg";
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;

  const { error } = await getClient()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) {
    throw new Error(`Foto-Upload zu Supabase Storage fehlgeschlagen: ${error.message}`);
  }

  const { data } = getClient().storage.from(env.SUPABASE_STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}
