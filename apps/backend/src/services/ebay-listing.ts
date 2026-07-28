import { getEbayApiBaseUrl } from "./ebay-oauth.js";
import { EBAY_MARKETPLACE_ID } from "../config/ebay.js";

function authHeaders(accessToken: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "de-DE",
    ...extra,
  };
}

// Rückgabetyp bewusst locker (kein offizielles eBay-SDK/Typen verfügbar) –
// die aufrufenden Funktionen greifen gezielt auf einzelne Felder der jeweils
// dokumentierten eBay-Response-Struktur zu.
async function ebayFetch(accessToken: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${getEbayApiBaseUrl()}${path}`, {
    ...init,
    headers: { ...authHeaders(accessToken), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    throw new Error(`eBay-API ${path} antwortete mit ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

export type BusinessPolicies = {
  paymentPolicyId: string;
  returnPolicyId: string;
  fulfillmentPolicyId: string;
};

/**
 * Holt die (einzige/erste) Business-Policy je Typ aus dem eBay-Verkäuferkonto.
 * eBay verlangt, dass diese bereits im Konto des Nutzers eingerichtet sind –
 * wir können sie nur lesen, nicht für den Nutzer anlegen.
 */
export async function getBusinessPolicies(accessToken: string): Promise<BusinessPolicies | null> {
  const [payment, returns, fulfillment] = await Promise.all([
    ebayFetch(accessToken, `/sell/account/v1/payment_policy?marketplace_id=${EBAY_MARKETPLACE_ID}`),
    ebayFetch(accessToken, `/sell/account/v1/return_policy?marketplace_id=${EBAY_MARKETPLACE_ID}`),
    ebayFetch(accessToken, `/sell/account/v1/fulfillment_policy?marketplace_id=${EBAY_MARKETPLACE_ID}`),
  ]);

  const paymentPolicyId = payment?.paymentPolicies?.[0]?.paymentPolicyId;
  const returnPolicyId = returns?.returnPolicies?.[0]?.returnPolicyId;
  const fulfillmentPolicyId = fulfillment?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;

  if (!paymentPolicyId || !returnPolicyId || !fulfillmentPolicyId) {
    return null;
  }
  return { paymentPolicyId, returnPolicyId, fulfillmentPolicyId };
}

/** Erste hinterlegte Lagerort-Kennung (Versandursprung) des Verkäuferkontos. */
export async function getMerchantLocationKey(accessToken: string): Promise<string | null> {
  const result = await ebayFetch(accessToken, "/sell/inventory/v1/location?limit=1");
  return result?.locations?.[0]?.merchantLocationKey ?? null;
}

export type CategorySuggestion = { categoryId: string; categoryName: string };

/**
 * Sucht eine passende eBay-Kategorie zu einem Freitext-Begriff (unsere
 * KI-Kategorie aus Phase 2 ist kein eBay-Kategoriebaum-Wert). Nimmt den
 * ersten/wahrscheinlichsten Treffer – bei Bedarf könnte der Nutzer später
 * aus mehreren Vorschlägen wählen, hier bewusst einfach gehalten.
 */
export async function suggestCategory(accessToken: string, query: string): Promise<CategorySuggestion | null> {
  const treeIdResult = await ebayFetch(
    accessToken,
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${EBAY_MARKETPLACE_ID}`
  );
  const treeId = treeIdResult?.categoryTreeId;
  if (!treeId) return null;

  const suggestions = await ebayFetch(
    accessToken,
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(query)}`
  );
  const first = suggestions?.categorySuggestions?.[0]?.category;
  if (!first?.categoryId) return null;
  return { categoryId: first.categoryId, categoryName: first.categoryName };
}

export type CreateDraftOfferInput = {
  sku: string;
  title: string;
  description: string;
  conditionId: string;
  priceChf: number;
  imageUrls: string[];
  categoryId: string;
  policies: BusinessPolicies;
  merchantLocationKey: string;
};

/**
 * Legt Inventory-Item + Angebot über die echte eBay-API an. Bewusst OHNE
 * abschliessenden Publish-Call (mit Nutzer abgestimmt) – das Angebot landet
 * als Entwurf im eBay-Verkäuferkonto, finale Veröffentlichung macht der
 * Nutzer selbst in der eBay-App/-Website.
 */
export async function createDraftOffer(
  accessToken: string,
  input: CreateDraftOfferInput
): Promise<{ offerId: string }> {
  await ebayFetch(accessToken, `/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`, {
    method: "PUT",
    body: JSON.stringify({
      product: {
        title: input.title,
        description: input.description,
        imageUrls: input.imageUrls,
      },
      availability: {
        shipToLocationAvailability: { quantity: 1 },
      },
    }),
  });

  const offerResult = await ebayFetch(accessToken, "/sell/inventory/v1/offer", {
    method: "POST",
    body: JSON.stringify({
      sku: input.sku,
      marketplaceId: EBAY_MARKETPLACE_ID,
      format: "FIXED_PRICE",
      availableQuantity: 1,
      categoryId: input.categoryId,
      listingDescription: input.description,
      conditionId: input.conditionId,
      pricingSummary: {
        price: { value: input.priceChf.toFixed(2), currency: "CHF" },
      },
      listingPolicies: {
        paymentPolicyId: input.policies.paymentPolicyId,
        returnPolicyId: input.policies.returnPolicyId,
        fulfillmentPolicyId: input.policies.fulfillmentPolicyId,
      },
      merchantLocationKey: input.merchantLocationKey,
    }),
  });

  if (!offerResult?.offerId) {
    throw new Error("eBay-Angebot wurde erstellt, aber keine offerId zurückgegeben.");
  }
  return { offerId: offerResult.offerId };
}
