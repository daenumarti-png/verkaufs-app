import * as Crypto from "expo-crypto";
import { getItem, setItem } from "./storage";

const STORAGE_KEY = "guest_device_id";

/**
 * Liefert eine lokal erzeugte, persistente anonyme Geräte-ID für den
 * Gastmodus (Backend Phase 10 – serverseitig durchgesetztes 5-Artikel-Limit).
 * Wird einmalig erzeugt und dauerhaft gespeichert, kein Personenbezug.
 */
export async function getOrCreateGuestDeviceId(): Promise<string> {
  const existing = await getItem(STORAGE_KEY);
  if (existing) return existing;

  const id = Crypto.randomUUID();
  await setItem(STORAGE_KEY, id);
  return id;
}
