import { Platform } from "react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import type { AnalyzeItemsResponse, ApiError, RefineEstimateRequest, RefineEstimateResponse } from "@verkaufs-app/shared";
import { getOrCreateGuestDeviceId } from "./guest-device-id";
import { getItem } from "./storage";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const AUTH_TOKEN_KEY = "auth_token";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError | null
  ) {
    super(body?.message ?? `Anfrage fehlgeschlagen (Status ${status})`);
  }
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const token = await getItem(AUTH_TOKEN_KEY);
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  const deviceId = await getOrCreateGuestDeviceId();
  return { "x-guest-device-id": deviceId };
}

/**
 * Hängt ein von expo-image-picker geliefertes Asset an ein FormData-Objekt.
 * Im Web ist asset.file je nach Picker-Konfiguration/Version nicht
 * zuverlässig gesetzt (empirisch beim Testen festgestellt) – robuster: die
 * asset.uri (blob:/data:-URI im Web) selbst per fetch in ein echtes Blob
 * auflösen. Nativ akzeptiert React Natives FormData-Polyfill dagegen ein
 * {uri, name, type}-Objekt als Datei-Repräsentation.
 */
async function appendPhoto(form: FormData, asset: ImagePickerAsset, index: number) {
  const fallbackName = `foto-${index + 1}.jpg`;
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    form.append("photos", blob, asset.fileName || fallbackName);
    return;
  }
  // React Natives FormData-Polyfill akzeptiert {uri, name, type} als
  // Datei-Repräsentation zur Laufzeit – die DOM-lib-Typen von FormData.append
  // kennen das nicht (erwarten Blob | string), daher der gezielte Cast.
  const nativeFilePart = { uri: asset.uri, name: asset.fileName || fallbackName, type: asset.mimeType || "image/jpeg" };
  form.append("photos", nativeFilePart as unknown as Blob);
}

export async function analyzeItems(photos: ImagePickerAsset[]): Promise<AnalyzeItemsResponse> {
  const form = new FormData();
  await Promise.all(photos.map((asset, index) => appendPhoto(form, asset, index)));

  const headers = await buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/items/analyze`, {
    method: "POST",
    headers,
    body: form,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as AnalyzeItemsResponse;
}

export async function refineEstimate(input: RefineEstimateRequest): Promise<RefineEstimateResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/items/refine-estimate`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as RefineEstimateResponse;
}
