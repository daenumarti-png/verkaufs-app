import { z } from "zod";

export const subscriptionTierSchema = z.enum(["BASIC", "PRO"]);
export const subscriptionStatusSchema = z.enum(["ACTIVE", "PAST_DUE", "CANCELED", "INCOMPLETE"]);

// Antwort für GET /billing/status. "subscription" ist null, wenn der Nutzer
// (noch) kein Abo hat – das UI behandelt das wie "kein Kontingent" (siehe
// billing-usage.ts: unsubscribed Nutzer werden wie Gäste mit 0 Kontingent behandelt).
export const billingStatusResponseSchema = z.object({
  subscription: z
    .object({
      tier: subscriptionTierSchema,
      status: subscriptionStatusSchema,
      currentPeriodEnd: z.string(),
    })
    .nullable(),
  remainingQuota: z.number().int().nonnegative(),
});

export const checkoutUrlResponseSchema = z.object({
  checkout_url: z.string(),
});

// Stripe-gehostetes Kundenportal (Rechnungshistorie + Zahlungsmethode
// verwalten) – siehe GET /billing/portal-url.
export const billingPortalUrlResponseSchema = z.object({
  portal_url: z.string(),
});

export type SubscriptionTier = z.infer<typeof subscriptionTierSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type BillingStatusResponse = z.infer<typeof billingStatusResponseSchema>;
export type CheckoutUrlResponse = z.infer<typeof checkoutUrlResponseSchema>;
export type BillingPortalUrlResponse = z.infer<typeof billingPortalUrlResponseSchema>;
