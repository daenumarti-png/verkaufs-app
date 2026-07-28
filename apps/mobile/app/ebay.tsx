import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import type { AuthUser } from "@verkaufs-app/shared";
import { getEbayStatus, getEbayConnectUrl, ApiRequestError } from "../lib/api";
import { getStoredUser } from "../lib/auth";
import { ACCENT, TEAL, BG, CARD, TEXT, MUTED } from "../constants/theme";

export default function EbayScreen() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      getStoredUser().then(setUser);
    }, [])
  );

  const statusQuery = useQuery({
    queryKey: ["ebay-status"],
    queryFn: getEbayStatus,
    enabled: Boolean(user),
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const { consent_url } = await getEbayConnectUrl();
      await WebBrowser.openBrowserAsync(consent_url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ebay-status"] });
    },
  });

  const connectErrorMessage =
    connectMutation.error instanceof ApiRequestError
      ? connectMutation.error.message
      : connectMutation.error
        ? "Verbindung zu eBay fehlgeschlagen. Bitte nochmals versuchen."
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
          <Text style={styles.title}>eBay-Verknüpfung</Text>
          <Text style={styles.subtitle}>
            Um dein eBay-Konto zu verknüpfen, musst du zuerst mit einem Konto angemeldet sein (kein Gastmodus).
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

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.title}>eBay-Verknüpfung</Text>
        <Text style={styles.subtitle}>
          Mit einer Verknüpfung kannst du Artikel-Entwürfe direkt in deinem eBay-Verkäuferkonto anlegen lassen –
          zur finalen Prüfung und Veröffentlichung immer in der eBay-App/-Website.
        </Text>

        {statusQuery.isPending && <ActivityIndicator color={ACCENT} />}
        {statusErrorMessage && <Text style={styles.errorText}>{statusErrorMessage}</Text>}

        {statusQuery.data?.connected && (
          <View style={styles.statusBox}>
            <Text style={styles.statusConnectedText}>eBay-Konto verknüpft ✓</Text>
          </View>
        )}

        {statusQuery.data && !statusQuery.data.connected && (
          <>
            <Pressable
              onPress={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              style={[styles.primaryButton, connectMutation.isPending && styles.primaryButtonDisabled]}
            >
              {connectMutation.isPending ? (
                <ActivityIndicator color={BG} />
              ) : (
                <Text style={styles.primaryButtonText}>Mit eBay verbinden</Text>
              )}
            </Pressable>
            {connectErrorMessage && <Text style={styles.errorText}>{connectErrorMessage}</Text>}
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
    alignItems: "center",
    marginBottom: 12,
  },
  statusConnectedText: { color: TEAL, fontWeight: "700", fontSize: 14 },
  errorText: { color: "#E08A6F", fontSize: 13, textAlign: "center", marginBottom: 12 },
  backButton: { alignItems: "center", paddingVertical: 12, marginTop: 8 },
  backButtonText: { color: MUTED, fontSize: 13.5 },
});
