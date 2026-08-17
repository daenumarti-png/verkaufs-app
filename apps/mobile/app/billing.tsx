import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import type { AuthUser, SubscriptionTier } from "@verkaufs-app/shared";
import { getBillingStatus, getBillingCheckoutUrl, getBillingPortalUrl, ApiRequestError } from "../lib/api";
import { getStoredUser } from "../lib/auth";
import { ACCENT, TEAL, BG, CARD, TEXT, MUTED } from "../constants/theme";

// Platzhalter-Anzeigepreise – müssen mit den echten Stripe-Price-IDs
// (config/subscription.ts im Backend) übereinstimmen, sobald diese existieren.
const PLAN_DISPLAY: Record<SubscriptionTier, { label: string; priceChf: string; included: number }> = {
  BASIC: { label: "Basic", priceChf: "9.90", included: 30 },
  PRO: { label: "Pro", priceChf: "24.90", included: 100 },
};

export default function BillingScreen() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      getStoredUser().then(setUser);
    }, [])
  );

  const statusQuery = useQuery({
    queryKey: ["subscription-status"],
    queryFn: getBillingStatus,
    enabled: Boolean(user),
  });

  const checkoutMutation = useMutation({
    mutationFn: async (tier: SubscriptionTier) => {
      const { checkout_url } = await getBillingCheckoutUrl(tier);
      await WebBrowser.openBrowserAsync(checkout_url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
    },
  });

  // Stripe-gehostetes Kundenportal: Rechnungshistorie ("Kosten einsehen")
  // + Zahlungsmethode ändern, ohne beides in der App selbst nachzubauen.
  const portalMutation = useMutation({
    mutationFn: async () => {
      const { portal_url } = await getBillingPortalUrl();
      await WebBrowser.openBrowserAsync(portal_url);
    },
  });

  const checkoutErrorMessage =
    checkoutMutation.error instanceof ApiRequestError
      ? checkoutMutation.error.message
      : checkoutMutation.error
        ? "Checkout konnte nicht gestartet werden. Bitte nochmals versuchen."
        : null;
  const portalErrorMessage =
    portalMutation.error instanceof ApiRequestError
      ? portalMutation.error.message
      : portalMutation.error
        ? "Kundenportal konnte nicht geöffnet werden. Bitte nochmals versuchen."
        : null;
  const statusErrorMessage =
    statusQuery.error instanceof ApiRequestError
      ? statusQuery.error.message
      : statusQuery.error
        ? "Status konnte nicht geladen werden."
        : null;

  if (user === undefined) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (user === null) {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.title}>Abo</Text>
          <Text style={styles.subtitle}>
            Um ein Abo abzuschliessen, musst du zuerst mit einem Konto angemeldet sein (kein Gastmodus).
          </Text>
          <Pressable onPress={() => router.push("/login")} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Zum Anmelden</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>Zurück</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const activeSubscription = statusQuery.data?.subscription;

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.title}>Abo</Text>
        <Text style={styles.subtitle}>
          Enthaltenes Kontingent pro Monat, danach Weiternutzung möglich – zusätzliche Analysen werden automatisch
          auf der nächsten Rechnung verrechnet.
        </Text>

        {statusQuery.isPending && <ActivityIndicator color={ACCENT} />}
        {statusErrorMessage && <Text style={styles.errorText}>{statusErrorMessage}</Text>}

        {activeSubscription && (
          <View style={styles.statusBox}>
            <Text style={styles.statusConnectedText}>
              {PLAN_DISPLAY[activeSubscription.tier].label}-Abo aktiv ✓
            </Text>
            <Text style={styles.statusDetailText}>
              Noch {statusQuery.data?.remainingQuota ?? 0} Analysen in dieser Periode inklusive
            </Text>
            <Text style={styles.statusDetailText}>
              Läuft bis {new Date(activeSubscription.currentPeriodEnd).toLocaleDateString("de-CH")}
            </Text>
          </View>
        )}

        {activeSubscription && (
          <View style={{ marginBottom: 12 }}>
            <Pressable
              onPress={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              style={[styles.portalButton, portalMutation.isPending && styles.primaryButtonDisabled]}
            >
              {portalMutation.isPending ? (
                <ActivityIndicator color={TEAL} />
              ) : (
                <Text style={styles.portalButtonText}>Kosten &amp; Zahlungsmethode verwalten</Text>
              )}
            </Pressable>
            {portalErrorMessage && <Text style={styles.errorText}>{portalErrorMessage}</Text>}
          </View>
        )}

        {statusQuery.data && !activeSubscription && (
          <>
            {(Object.keys(PLAN_DISPLAY) as SubscriptionTier[]).map((tier) => (
              <View key={tier} style={styles.planCard}>
                <Text style={styles.planTitle}>{PLAN_DISPLAY[tier].label}</Text>
                <Text style={styles.planPrice}>CHF {PLAN_DISPLAY[tier].priceChf} / Monat</Text>
                <Text style={styles.planDetail}>{PLAN_DISPLAY[tier].included} Analysen inklusive</Text>
                <Pressable
                  onPress={() => checkoutMutation.mutate(tier)}
                  disabled={checkoutMutation.isPending}
                  style={[styles.primaryButton, checkoutMutation.isPending && styles.primaryButtonDisabled]}
                >
                  {checkoutMutation.isPending ? (
                    <ActivityIndicator color={BG} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Abonnieren</Text>
                  )}
                </Pressable>
              </View>
            ))}
            {checkoutErrorMessage && <Text style={styles.errorText}>{checkoutErrorMessage}</Text>}
          </>
        )}

        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Zurück</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
  content: { width: "100%", maxWidth: 420, padding: 24 },
  title: { color: TEXT, fontSize: 24, fontWeight: "700", marginBottom: 10, textAlign: "center" },
  subtitle: { color: MUTED, fontSize: 13.5, lineHeight: 20, marginBottom: 24, textAlign: "center" },
  planCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  planTitle: { color: TEXT, fontSize: 17, fontWeight: "700", marginBottom: 4 },
  planPrice: { color: ACCENT, fontSize: 15, fontWeight: "600", marginBottom: 2 },
  planDetail: { color: MUTED, fontSize: 13, marginBottom: 12 },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: BG, fontWeight: "700", fontSize: 15 },
  statusBox: {
    backgroundColor: CARD,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TEAL,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  statusConnectedText: { color: TEAL, fontWeight: "700", fontSize: 14, marginBottom: 6 },
  portalButton: {
    borderWidth: 1,
    borderColor: TEAL,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  portalButtonText: { color: TEAL, fontWeight: "700", fontSize: 14 },
  statusDetailText: { color: MUTED, fontSize: 12.5, marginBottom: 2 },
  errorText: { color: "#E08A6F", fontSize: 13, textAlign: "center", marginBottom: 12 },
  backButton: { alignItems: "center", paddingVertical: 12, marginTop: 8 },
  backButtonText: { color: MUTED, fontSize: 13.5 },
});
