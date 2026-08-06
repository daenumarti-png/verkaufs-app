// Abo-Stufen (Platzhalter-Preise – anpassen, sobald echte Stripe-Price-IDs
// existieren, siehe STRIPE_PRICE_ID_BASIC/STRIPE_PRICE_ID_PRO in env.ts).
// includedAnalyses = im Abo enthaltenes Kontingent pro Abrechnungsperiode
// (Einheit: ein /items/analyze-Aufruf, siehe billing-usage.ts).
// overagePriceChfCents = Preis pro zusätzlicher Analyse über das
// Kontingent hinaus (wird als einmalige Stripe-Invoice-Item-Position auf
// die nächste Rechnung gebucht, siehe routes/billing.ts Webhook-Handler).
export const SUBSCRIPTION_TIERS = {
  BASIC: { includedAnalyses: 30, overagePriceChfCents: 50 },
  PRO: { includedAnalyses: 100, overagePriceChfCents: 30 },
} as const;

export type SubscriptionTierKey = keyof typeof SUBSCRIPTION_TIERS;
