import type { ListingPlatform, PrepareListingsRequest } from "@verkaufs-app/shared";

// Bewusst kein Navigation-Param: die Beschreibung kann bis zu 2000 Zeichen
// lang sein, das würde auf Web als Query-String unhandlich/riskant. Die App
// läuft in einem einzigen JS-Kontext, ein Modul-Singleton reicht als kurze
// Brücke zwischen Home- und Export-Screen (kein Persistenzbedarf).
let pendingItem: PrepareListingsRequest["item"] | null = null;
// KI-Plattform-Empfehlung (item.platform_recommendation) für diesen Artikel,
// falls vorhanden – der Export-Screen fügt sie den Standard-Plattformen
// hinzu und markiert sie als "Empfohlen". Bundle-Exporte haben keine
// Empfehlung (bundle_recommendation kennt kein platform_recommendation),
// daher optional statt Pflichtfeld.
let pendingRecommendedPlatform: ListingPlatform | undefined;

export function setExportItem(item: PrepareListingsRequest["item"], recommendedPlatform?: ListingPlatform): void {
  pendingItem = item;
  pendingRecommendedPlatform = recommendedPlatform;
}

export function consumeExportItem(): PrepareListingsRequest["item"] | null {
  return pendingItem;
}

export function consumeRecommendedPlatform(): ListingPlatform | undefined {
  return pendingRecommendedPlatform;
}
