import Stripe from "stripe";
import type { User } from "@prisma/client";
import type { SubscriptionTierKey } from "../config/subscription.js";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";

let client: Stripe | undefined;

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID_BASIC && env.STRIPE_PRICE_ID_PRO);
}

function getClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe ist nicht konfiguriert (STRIPE_SECRET_KEY fehlt).");
  }
  client ??= new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

function priceIdForTier(tier: SubscriptionTierKey): string {
  const priceId = tier === "BASIC" ? env.STRIPE_PRICE_ID_BASIC : env.STRIPE_PRICE_ID_PRO;
  if (!priceId) {
    throw new Error(`Stripe ist nicht konfiguriert (Price-ID für Tier ${tier} fehlt).`);
  }
  return priceId;
}

/**
 * Legt bei Stripe einen Customer an, falls der Nutzer noch keinen hat
 * (erkennbar an einer bestehenden Subscription-Zeile mit stripeCustomerId –
 * ein Customer wird bewusst erst bei Bedarf angelegt, nicht schon bei der
 * Registrierung, um keine "leeren" Stripe-Kunden ohne echte Kaufabsicht zu erzeugen).
 */
export async function getOrCreateStripeCustomer(user: User): Promise<string> {
  const existing = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (existing) return existing.stripeCustomerId;

  const stripe = getClient();
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });
  return customer.id;
}

/**
 * Erstellt eine Stripe-Checkout-Session für das gewählte Abo-Tier. Der
 * Erfolgs-/Abbruch-Redirect zeigt auf das eigene App-Schema
 * (verkaufsassistent://), da Stripe Checkout – anders als eine generische
 * OAuth-Consent-Seite – echte Redirect-URLs unterstützt.
 */
export async function createCheckoutSession(user: User, tier: SubscriptionTierKey): Promise<string> {
  const stripe = getClient();
  const customerId = await getOrCreateStripeCustomer(user);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceIdForTier(tier), quantity: 1 }],
    success_url: "verkaufsassistent://billing/success",
    cancel_url: "verkaufsassistent://billing/cancel",
    metadata: { userId: user.id, tier },
  });

  if (!session.url) {
    throw new Error("Stripe hat keine Checkout-URL zurückgegeben.");
  }
  return session.url;
}

export function getStripeClient(): Stripe {
  return getClient();
}
