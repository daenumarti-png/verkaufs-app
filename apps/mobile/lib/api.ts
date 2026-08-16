import { Platform } from "react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import type {
  AnalyzeItemsResponse,
  ApiError,
  RefineEstimateRequest,
  RefineEstimateResponse,
  PrepareListingsRequest,
  PrepareListingsResponse,
  CollectorResearchRequest,
  CollectorValueResponse,
  HeroImageComposingResult,
  ComposeMarketingHeroImageFields,
  BoundingBox,
  EbayDraftFields,
  EbayDraftResult,
  SubscriptionTier,
  BillingStatusResponse,
  CheckoutUrlResponse,
  DetailedDescriptionQuestionsFields,
  DetailedDescriptionQuestionsResult,
  DetailedDescriptionGenerateRequest,
  DetailedDescriptionResult,
} from "@verkaufs-app/shared";
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

// Phase 4b: optionale Bounding Box, damit der Freisteller nur den einen
// erkannten Artikel zeigt statt des ganzen Fotos (relevant bei mehreren
// Artikeln auf einem Gruppenfoto). Ohne Box: bisheriges Verhalten (ganzes Foto).
function appendBoundingBox(form: FormData, box: BoundingBox | null | undefined) {
  if (!box) return;
  form.append("bbox_x", String(box.x));
  form.append("bbox_y", String(box.y));
  form.append("bbox_width", String(box.width));
  form.append("bbox_height", String(box.height));
}

export async function composeHeroImage(
  photo: ImagePickerAsset,
  boundingBox?: BoundingBox | null
): Promise<HeroImageComposingResult> {
  const form = new FormData();
  await appendPhoto(form, photo, 0);
  appendBoundingBox(form, boundingBox);

  const res = await fetch(`${API_BASE_URL}/items/hero-image/composing`, {
    method: "POST",
    body: form,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as HeroImageComposingResult;
}

export async function composeMarketingHeroImage(
  photo: ImagePickerAsset,
  fields: ComposeMarketingHeroImageFields,
  boundingBox?: BoundingBox | null
): Promise<HeroImageComposingResult> {
  const form = new FormData();
  await appendPhoto(form, photo, 0);
  form.append("title", fields.title);
  form.append("price_chf", String(fields.price_chf));
  if (fields.condition_guess) form.append("condition_guess", fields.condition_guess);
  appendBoundingBox(form, boundingBox);

  const res = await fetch(`${API_BASE_URL}/items/hero-image/marketing`, {
    method: "POST",
    body: form,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as HeroImageComposingResult;
}

export async function getDetailedDescriptionQuestions(
  photo: ImagePickerAsset,
  fields: DetailedDescriptionQuestionsFields
): Promise<DetailedDescriptionQuestionsResult> {
  const form = new FormData();
  await appendPhoto(form, photo, 0);
  form.append("name", fields.name);
  form.append("category", fields.category);
  form.append("condition_guess", fields.condition_guess);

  const res = await fetch(`${API_BASE_URL}/items/detailed-description/questions`, {
    method: "POST",
    body: form,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as DetailedDescriptionQuestionsResult;
}

export async function generateDetailedDescription(
  input: DetailedDescriptionGenerateRequest
): Promise<DetailedDescriptionResult> {
  const res = await fetch(`${API_BASE_URL}/items/detailed-description/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as DetailedDescriptionResult;
}

export async function getEbayStatus(): Promise<{ connected: boolean }> {
  const headers = await buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/ebay/status`, { headers });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as { connected: boolean };
}

export async function getEbayConnectUrl(): Promise<{ consent_url: string }> {
  const headers = await buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/ebay/connect`, { headers });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as { consent_url: string };
}

export async function createEbayDraft(fields: EbayDraftFields, photos: ImagePickerAsset[]): Promise<EbayDraftResult> {
  const form = new FormData();
  await Promise.all(photos.map((asset, index) => appendPhoto(form, asset, index)));
  form.append("title", fields.title);
  form.append("description", fields.description);
  form.append("price_chf", String(fields.price_chf));
  form.append("category", fields.category);
  if (fields.condition_guess) form.append("condition_guess", fields.condition_guess);

  const headers = await buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/items/ebay/prepare-draft`, {
    method: "POST",
    headers,
    body: form,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as EbayDraftResult;
}

export async function researchCollectorValue(input: CollectorResearchRequest): Promise<CollectorValueResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/items/research-collector-value`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as CollectorValueResponse;
}

export async function prepareListings(input: PrepareListingsRequest): Promise<PrepareListingsResponse> {
  const res = await fetch(`${API_BASE_URL}/items/prepare-listings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as PrepareListingsResponse;
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

export async function getBillingStatus(): Promise<BillingStatusResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/billing/status`, { headers });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as BillingStatusResponse;
}

export async function getBillingCheckoutUrl(tier: SubscriptionTier): Promise<CheckoutUrlResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/billing/checkout-url?tier=${tier}`, { headers });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body);
  }
  return body as CheckoutUrlResponse;
}
