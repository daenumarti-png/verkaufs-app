// Farbpalette aus verkaufs-app-prototyp.jsx übernommen, damit die echte App
// optisch am validierten Referenz-Entwurf anknüpft.
export const ACCENT = "#D4A017"; // Preis-Senf
export const TEAL = "#4A7A6D"; // Sold/Score-Grün
export const BG = "#1C1B19";
export const CARD = "#26241F";
export const TEXT = "#EDE8DF";
export const MUTED = "#8A857A";
export const DANGER = "#B5533C";

export function scoreColor(score: number): string {
  if (score >= 7) return TEAL;
  if (score >= 4) return ACCENT;
  return DANGER;
}
