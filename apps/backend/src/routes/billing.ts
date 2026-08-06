import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import type { ApiError, BillingStatusResponse, CheckoutUrlResponse } from "@verkaufs-app/shared";
import { requireUserId } from "../lib/auth-context.js";
import { env } from "../config/env.js";
import { SUBSCRIPTION_TIERS, type SubscriptionTierKey } from "../config/subscription.js";
import { isStripeConfigured, createCheckoutSession, getStripeClient } from "../services/stripe.js";
import { getRemainingQuota } from "../services/billing-usage.js";
import { prisma } from "../db/client.js";
import { EXPENSIVE_ENDPOINT_RATE_LIMIT } from "../config/rate-limit.js";

function errorReply(error: string, message: string): ApiError {
  return { error, message };
}

function tierForPriceId(priceId: string | undefined): SubscriptionTierKey | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_ID_BASIC) return "BASIC";
  if (priceId === env.STRIPE_PRICE_ID_PRO) return "PRO";
  return null;
}

// Bildet Stripes Subscription-Status auf unser eigenes, schlankeres Enum ab
// (trialing wird wie active behandelt – Trials sind aktuell nicht Teil der
// Preisgestaltung, aber falls später eingeführt, soll das Konto nutzbar bleiben).
function mapStripeStatus(status: Stripe.Subscription.Status): "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" {
  switch (status) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}

async function upsertSubscriptionFromStripe(sub: Stripe.Subscription, userId: string): Promise<void> {
  const item = sub.items.data[0];
  const tier = tierForPriceId(item?.price.id);
  if (!tier || !item) {
    throw new Error(`Unbekannte Stripe-Price-ID in Subscription ${sub.id} – kein Tier zuordenbar.`);
  }

  // Seit einer neueren Stripe-API-Version liegen current_period_start/end
  // nicht mehr auf der Subscription selbst, sondern auf dem einzelnen
  // SubscriptionItem (Abos können mehrere Items mit unterschiedlichen
  // Abrechnungszyklen haben) – hier gibt es genau ein Item pro Abo.
  const currentPeriodStart = new Date(item.current_period_start * 1000);
  const currentPeriodEnd = new Date(item.current_period_end * 1000);

  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
      tier,
      status: mapStripeStatus(sub.status),
      currentPeriodStart,
      currentPeriodEnd,
    },
    update: {
      stripeSubscriptionId: sub.id,
      tier,
      status: mapStripeStatus(sub.status),
      currentPeriodStart,
      currentPeriodEnd,
    },
  });
}

export async function billingRoutes(app: FastifyInstance) {
  app.get("/billing/checkout-url", { config: { rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT } }, async (req, reply) => {
    const userId = await requireUserId(req, reply);
    if (!userId) return;

    if (!isStripeConfigured()) {
      return reply
        .status(503)
        .send(errorReply("service_unavailable", "Abrechnung ist aktuell nicht konfiguriert."));
    }

    const query = req.query as Record<string, string | undefined>;
    const tier = query.tier;
    if (tier !== "BASIC" && tier !== "PRO") {
      return reply.status(400).send(errorReply("invalid_request", "Ungültiges Abo-Tier (BASIC oder PRO erwartet)."));
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(401).send(errorReply("invalid_token", "Nutzer nicht gefunden."));
    }

    try {
      const checkoutUrl = await createCheckoutSession(user, tier);
      const responseBody: CheckoutUrlResponse = { checkout_url: checkoutUrl };
      return reply.status(200).send(responseBody);
    } catch (err) {
      req.log.error(err, "Stripe-Checkout-Session konnte nicht erstellt werden");
      return reply
        .status(502)
        .send(errorReply("checkout_failed", "Checkout konnte nicht gestartet werden. Bitte nochmals versuchen."));
    }
  });

  app.get("/billing/status", async (req, reply) => {
    const userId = await requireUserId(req, reply);
    if (!userId) return;

    const [subscription, quota] = await Promise.all([
      prisma.subscription.findUnique({ where: { userId } }),
      getRemainingQuota(userId),
    ]);

    const responseBody: BillingStatusResponse = {
      subscription: subscription
        ? {
            tier: subscription.tier,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          }
        : null,
      remainingQuota: quota.hasSubscription ? quota.remaining : 0,
    };
    return reply.status(200).send(responseBody);
  });

  // Stripe-Webhook: braucht den ROHEN Request-Body für die Signaturprüfung
  // (stripe.webhooks.constructEvent) – der globale JSON-Parser würde ihn
  // sonst schon geparst haben. Deshalb in einem eigenen, gekapselten
  // Plugin-Kontext registriert: der Content-Type-Parser-Override gilt nur
  // hier, nicht für die restlichen JSON-Routen der App. Kein Rate-Limit,
  // da Stripes Infrastruktur (nicht Endnutzer) diese Route aufruft –
  // Vertrauen kommt allein aus der Signaturprüfung.
  await app.register(async function webhookPlugin(instance) {
    instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });

    instance.post("/billing/webhook", { config: { rateLimit: false } }, async (req, reply) => {
      if (!isStripeConfigured() || !env.STRIPE_WEBHOOK_SECRET) {
        return reply
          .status(503)
          .send(errorReply("service_unavailable", "Abrechnung ist aktuell nicht konfiguriert."));
      }

      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string") {
        return reply.status(400).send(errorReply("invalid_request", "Fehlende Stripe-Signatur."));
      }

      const stripe = getStripeClient();
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        req.log.warn(err, "Stripe-Webhook-Signatur ungültig");
        return reply.status(400).send(errorReply("invalid_signature", "Signatur konnte nicht verifiziert werden."));
      }

      try {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            const userId = session.metadata?.userId;
            if (userId && typeof session.subscription === "string") {
              const sub = await stripe.subscriptions.retrieve(session.subscription);
              await upsertSubscriptionFromStripe(sub, userId);
            }
            break;
          }
          case "customer.subscription.updated":
          case "customer.subscription.deleted": {
            const sub = event.data.object as Stripe.Subscription;
            const existing = await prisma.subscription.findUnique({
              where: { stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id },
            });
            if (existing) {
              await upsertSubscriptionFromStripe(sub, existing.userId);
            }
            break;
          }
          case "invoice.upcoming": {
            const invoice = event.data.object as Stripe.Invoice;
            const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
            if (!customerId) break;

            const subscription = await prisma.subscription.findUnique({ where: { stripeCustomerId: customerId } });
            if (!subscription) break;

            const usage = await prisma.usageRecord.findUnique({
              where: { userId_periodStart: { userId: subscription.userId, periodStart: subscription.currentPeriodStart } },
            });
            const included = SUBSCRIPTION_TIERS[subscription.tier].includedAnalyses;
            const overage = Math.max(0, (usage?.analysesUsed ?? 0) - included);

            if (overage > 0) {
              const overagePriceChfCents = SUBSCRIPTION_TIERS[subscription.tier].overagePriceChfCents;
              await stripe.invoiceItems.create({
                customer: customerId,
                currency: "chf",
                amount: overage * overagePriceChfCents,
                description: `${overage} zusätzliche Analyse(n) über das ${subscription.tier}-Kontingent hinaus`,
              });
            }
            break;
          }
          default:
            break;
        }
      } catch (err) {
        req.log.error(err, `Stripe-Webhook-Verarbeitung fehlgeschlagen (${event.type})`);
        return reply.status(500).send(errorReply("webhook_processing_failed", "Verarbeitung fehlgeschlagen."));
      }

      return reply.status(200).send({ received: true });
    });
  });
}
