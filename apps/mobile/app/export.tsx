import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { ListingPlatform, PlatformListing } from "@verkaufs-app/shared";
import { prepareListings, ApiRequestError } from "../lib/api";
import { consumeExportItem, consumeRecommendedPlatform } from "../lib/export-store";
import { ACCENT, TEAL, BG, CARD, TEXT, MUTED } from "../constants/theme";

const PLATFORM_LABELS: Record<ListingPlatform, string> = {
  TUTTI: "Tutti",
  RICARDO: "Ricardo",
  EBAY: "eBay",
  VINTED: "Vinted",
  ANIBIS: "Anibis",
  FACEBOOK_MARKETPLACE: "Facebook Marketplace",
};

const BASE_PLATFORMS: ListingPlatform[] = ["TUTTI", "RICARDO", "EBAY"];

export default function ExportScreen() {
  // Wird beim ersten Rendern konsumiert (Modul-Singleton, siehe
  // lib/export-store.ts) – daher in einem Ref statt bei jedem Render neu lesen.
  const itemRef = useRef(consumeExportItem());
  const item = itemRef.current;
  // Nur relevant, wenn die KI für diesen Artikel eine zusätzliche Plattform
  // (Vinted/Anibis/Facebook Marketplace) empfohlen hat - siehe lib/export-store.ts.
  const recommendedPlatformRef = useRef(consumeRecommendedPlatform());
  const recommendedPlatform = recommendedPlatformRef.current;
  const platforms = recommendedPlatform && !BASE_PLATFORMS.includes(recommendedPlatform)
    ? [...BASE_PLATFORMS, recommendedPlatform]
    : BASE_PLATFORMS;

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    };
  }, []);

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["prepare-listings", item?.name],
    queryFn: () => prepareListings({ item: item!, platforms }),
    enabled: item !== null,
  });

  const handleCopy = async (key: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedKey(key);
    if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    copiedTimeout.current = setTimeout(() => setCopiedKey(null), 1600);
  };

  const errorMessage =
    error instanceof ApiRequestError ? error.message : error ? "Export fehlgeschlagen. Bitte nochmals versuchen." : null;

  if (!item) {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.title}>Kein Artikel ausgewählt</Text>
          <Text style={styles.subtitle}>Bitte von der Artikel-Übersicht aus exportieren.</Text>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>Zurück</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        <Text style={styles.kicker}>Export</Text>
        <Text style={styles.title}>{item.suggested_title}</Text>
        <Text style={styles.subtitle}>Kopierfertige Angaben für die passenden Plattformen.</Text>

        {isPending && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.loadingText}>Bereite Export vor …</Text>
          </View>
        )}

        {isError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable onPress={() => refetch()} style={styles.retryButton} disabled={isFetching}>
              <Text style={styles.retryButtonText}>Nochmals versuchen</Text>
            </Pressable>
          </View>
        )}

        {data?.listings.map((listing) => (
          <PlatformSection
            key={listing.platform}
            listing={listing}
            copiedKey={copiedKey}
            onCopy={handleCopy}
            isRecommended={listing.platform === recommendedPlatform}
          />
        ))}

        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Zurück zur Übersicht</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function PlatformSection({
  listing,
  copiedKey,
  onCopy,
  isRecommended,
}: {
  listing: PlatformListing;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  isRecommended: boolean;
}) {
  const fullTextKey = `${listing.platform}:full`;
  return (
    <View style={styles.platformCard}>
      <View style={styles.platformHeader}>
        <View style={styles.platformTitleRow}>
          <Text style={styles.platformTitle}>{PLATFORM_LABELS[listing.platform]}</Text>
          {isRecommended && (
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedBadgeText}>Empfohlen</Text>
            </View>
          )}
        </View>
        <Pressable onPress={() => onCopy(fullTextKey, listing.full_text)} style={styles.copyAllButton}>
          <Text style={styles.copyAllButtonText}>{copiedKey === fullTextKey ? "Kopiert ✓" : "Alles kopieren"}</Text>
        </Pressable>
      </View>

      {listing.fields.map((field) => {
        const key = `${listing.platform}:${field.key}`;
        const copied = copiedKey === key;
        return (
          <View key={field.key} style={styles.fieldRow}>
            <View style={styles.fieldTextBlock}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <Text style={styles.fieldValue}>{field.value}</Text>
            </View>
            <Pressable onPress={() => onCopy(key, field.value)} style={styles.fieldCopyButton}>
              <Text style={styles.fieldCopyButtonText}>{copied ? "✓" : "Kopieren"}</Text>
            </Pressable>
          </View>
        );
      })}

      {listing.notes.length > 0 && (
        <View style={styles.notesBox}>
          {listing.notes.map((note, i) => (
            <Text key={i} style={styles.noteText}>
              {note}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  scrollContent: { flexGrow: 1, alignItems: "center" },
  content: { maxWidth: 480, width: "100%", padding: 16, paddingBottom: 48 },
  kicker: { color: MUTED, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase" },
  title: { color: TEXT, fontSize: 22, fontWeight: "700", marginTop: 6, marginBottom: 4 },
  subtitle: { color: MUTED, fontSize: 14, marginBottom: 18 },
  loadingBox: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16 },
  loadingText: { color: MUTED, fontSize: 13.5 },
  errorBox: {
    backgroundColor: "rgba(181,83,60,0.1)",
    borderColor: "rgba(181,83,60,0.35)",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  errorText: { color: "#E08A6F", fontSize: 13 },
  retryButton: { alignSelf: "flex-start" },
  retryButtonText: { color: ACCENT, fontSize: 13, fontWeight: "700" },
  platformCard: { backgroundColor: CARD, borderRadius: 14, padding: 16, marginBottom: 14 },
  platformHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  platformTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  platformTitle: { color: TEXT, fontSize: 17, fontWeight: "700" },
  recommendedBadge: {
    backgroundColor: "rgba(45,138,130,0.18)",
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  recommendedBadgeText: { color: TEAL, fontSize: 10.5, fontWeight: "700", textTransform: "uppercase" },
  copyAllButton: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  copyAllButtonText: { color: BG, fontSize: 12.5, fontWeight: "700" },
  fieldRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#3A382F",
    paddingTop: 10,
    marginTop: 10,
  },
  fieldTextBlock: { flex: 1 },
  fieldLabel: { color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  fieldValue: { color: TEXT, fontSize: 13.5, lineHeight: 19 },
  fieldCopyButton: {
    borderWidth: 1,
    borderColor: TEAL,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  fieldCopyButtonText: { color: TEAL, fontSize: 12, fontWeight: "700" },
  notesBox: { marginTop: 12, gap: 4 },
  noteText: { color: MUTED, fontSize: 11.5, lineHeight: 16 },
  backButton: { alignItems: "center", paddingVertical: 13, marginTop: 6 },
  backButtonText: { color: MUTED, fontSize: 13.5 },
});
