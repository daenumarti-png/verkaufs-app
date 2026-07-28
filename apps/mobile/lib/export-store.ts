import type { PrepareListingsRequest } from "@verkaufs-app/shared";

// Bewusst kein Navigation-Param: die Beschreibung kann bis zu 2000 Zeichen
// lang sein, das würde auf Web als Query-String unhandlich/riskant. Die App
// läuft in einem einzigen JS-Kontext, ein Modul-Singleton reicht als kurze
// Brücke zwischen Home- und Export-Screen (kein Persistenzbedarf).
let pendingItem: PrepareListingsRequest["item"] | null = null;

export function setExportItem(item: PrepareListingsRequest["item"]): void {
  pendingItem = item;
}

export function consumeExportItem(): PrepareListingsRequest["item"] | null {
  return pendingItem;
}
