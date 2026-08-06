import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, Image, StyleSheet, ActivityIndicator, Linking } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import type {
  AnalyzedItem,
  AnalyzeItemsResponse,
  AuthUser,
  BoundingBox,
  CollectorValueResult,
  ListingPlatform,
  PrepareListingsRequest,
} from "@verkaufs-app/shared";
import {
  analyzeItems,
  refineEstimate,
  researchCollectorValue,
  composeHeroImage,
  composeMarketingHeroImage,
  getEbayStatus,
  createEbayDraft,
  ApiRequestError,
} from "../lib/api";
import { getStoredUser, signOut } from "../lib/auth";
import { setExportItem } from "../lib/export-store";
import { ACCENT, TEAL, BG, CARD, TEXT, MUTED, scoreColor, confidenceColor } from "../constants/theme";

const MAX_PHOTOS = 6;

// Anzeige-Labels für die KI-Plattform-Empfehlung (item.platform_recommendation) –
// bewusst nur die drei zusätzlichen Plattformen, da Tutti/Ricardo/eBay ohnehin
// immer als Standard-Export-Optionen angezeigt werden.
const PLATFORM_RECOMMENDATION_LABELS: Record<ListingPlatform, string> = {
  TUTTI: "Tutti",
  RICARDO: "Ricardo",
  EBAY: "eBay",
  VINTED: "Vinted",
  ANIBIS: "Anibis",
  FACEBOOK_MARKETPLACE: "Facebook Marketplace",
};

type ResultMeta = Omit<AnalyzeItemsResponse, "items">;

export default function HomeScreen() {
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [items, setItems] = useState<AnalyzedItem[] | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);
  const [answeredChips, setAnsweredChips] = useState<Record<string, string>>({});
  const [refinementNotes, setRefinementNotes] = useState<Record<number, string>>({});
  const [refiningIndex, setRefiningIndex] = useState<number | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userChecked, setUserChecked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getStoredUser().then((stored) => {
        setUser(stored);
        setUserChecked(true);
      });
    }, [])
  );

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
  };

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeItems(photos),
    onSuccess: (data) => {
      const { items: newItems, ...meta } = data;
      setItems(newItems);
      setResultMeta(meta);
      setAnsweredChips({});
      setRefinementNotes({});
    },
  });

  const errorMessage =
    analyzeMutation.error instanceof ApiRequestError
      ? analyzeMutation.error.message
      : analyzeMutation.error
        ? "Analyse fehlgeschlagen. Bitte nochmals versuchen."
        : null;

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!result.canceled) {
      setPhotos((prev) => [...prev, ...result.assets].slice(0, MAX_PHOTOS));
    }
  };

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
    });
    if (!result.canceled) {
      setPhotos((prev) => [...prev, ...result.assets].slice(0, MAX_PHOTOS));
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const reset = () => {
    setPhotos([]);
    setItems(null);
    setResultMeta(null);
    setAnsweredChips({});
    setRefinementNotes({});
    analyzeMutation.reset();
  };

  const handleExport = (item: AnalyzedItem) => {
    setExportItem({
      name: item.name,
      category: item.category,
      condition_guess: item.condition_guess,
      suggested_title: item.suggested_title,
      suggested_description: item.suggested_description,
      estimated_price_chf_min: item.estimated_price_chf_min,
      estimated_price_chf_max: item.estimated_price_chf_max,
      best_selling_period: item.best_selling_period.period,
    }, item.platform_recommendation?.platform);
    router.push("/export");
  };

  const handleExportBundle = () => {
    const bundle = resultMeta?.bundle_recommendation;
    if (!bundle || !bundle.recommended) return;
    // suggested_title/suggested_description/category sind laut Schema
    // garantiert nicht-leer, wenn recommended=true (siehe .refine() in
    // bundleRecommendationSchema) - die Fallbacks hier greifen nur defensiv.
    const bundleItem: PrepareListingsRequest["item"] = {
      name: bundle.suggested_title ?? "Bundle",
      category: bundle.category ?? "",
      suggested_title: bundle.suggested_title ?? "",
      suggested_description: bundle.suggested_description ?? "",
      // Das Modell liefert nur EINEN Bundle-Preis, keine Spanne - min/max
      // beide auf denselben Wert zu setzen ist der einzig sinnvolle Weg, das
      // flache PrepareListingsRequest["item"]-Schema (das eine Spanne
      // erwartet) ohne Backend-Änderung wiederzuverwenden.
      estimated_price_chf_min: bundle.bundle_price_chf ?? 0,
      estimated_price_chf_max: bundle.bundle_price_chf ?? 0,
    };
    setExportItem(bundleItem);
    router.push("/export");
  };

  const handleAnswerChip = async (itemIndex: number, question: string, option: string) => {
    if (!items) return;
    const key = `${itemIndex}-${question}`;
    setAnsweredChips((prev) => ({ ...prev, [key]: option }));
    setRefiningIndex(itemIndex);
    const item = items[itemIndex];
    try {
      const updated = await refineEstimate({
        name: item.name,
        category: item.category,
        condition_guess: item.condition_guess,
        current_estimate: {
          estimated_price_chf_min: item.estimated_price_chf_min,
          estimated_price_chf_max: item.estimated_price_chf_max,
          sell_score: item.sell_score,
          estimated_days_to_sell: item.estimated_days_to_sell,
        },
        clarifying_answers: [{ question, selected_option: option }],
      });
      setItems((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        next[itemIndex] = {
          ...next[itemIndex],
          estimated_price_chf_min: updated.estimated_price_chf_min,
          estimated_price_chf_max: updated.estimated_price_chf_max,
          sell_score: updated.sell_score,
          estimated_days_to_sell: updated.estimated_days_to_sell,
        };
        return next;
      });
      setRefinementNotes((prev) => ({ ...prev, [itemIndex]: updated.adjustment_reasoning }));
    } catch {
      // Aktualisierung fehlgeschlagen: Chip bleibt markiert, ursprüngliche Schätzung bleibt sichtbar
    } finally {
      setRefiningIndex(null);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Verkaufs-Assistent</Text>
        <Text style={styles.title}>Foto rein, Inserat raus.</Text>
        <Text style={styles.subtitle}>
          Bis zu {MAX_PHOTOS} Fotos. Die KI erkennt Artikel, schätzt Preis, Score und Verkaufsdauer.
        </Text>
      </View>

      {userChecked && (
        <View style={styles.accountRow}>
          {user ? (
            <>
              <Text style={styles.accountText}>Angemeldet als {user.email}</Text>
              <View style={styles.accountActions}>
                <Pressable onPress={() => router.push("/billing")}>
                  <Text style={styles.accountAction}>Abo</Text>
                </Pressable>
                <Pressable onPress={() => router.push("/ebay")}>
                  <Text style={styles.accountAction}>eBay</Text>
                </Pressable>
                <Pressable onPress={handleSignOut}>
                  <Text style={styles.accountAction}>Abmelden</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.accountText}>Gastmodus · bis zu 5 Artikel</Text>
              <Pressable onPress={() => router.push("/login")}>
                <Text style={styles.accountAction}>Anmelden</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      <View style={styles.disclaimerBox}>
        <Text style={styles.disclaimerText}>
          Preis- und Score-Schätzungen basieren auf KI-Einschätzung, keine Garantie.
        </Text>
      </View>

      <View style={styles.photoGrid}>
        {photos.map((photo, index) => (
          <View key={photo.assetId ?? photo.uri ?? index} style={styles.photoTile}>
            <Image source={{ uri: photo.uri }} style={styles.photoImage} />
            <Pressable onPress={() => removePhoto(index)} style={styles.removeButton} accessibilityLabel="Foto entfernen">
              <Text style={styles.removeButtonText}>×</Text>
            </Pressable>
          </View>
        ))}
        {photos.length < MAX_PHOTOS && (
          <Pressable onPress={pickFromCamera} style={styles.addTile}>
            <Text style={styles.addTileText}>📷{"\n"}Aufnehmen</Text>
          </Pressable>
        )}
        {photos.length < MAX_PHOTOS && (
          <Pressable onPress={pickFromLibrary} style={styles.addTile}>
            <Text style={styles.addTileText}>⬆{"\n"}Hochladen</Text>
          </Pressable>
        )}
      </View>

      {!items && (
        <Pressable
          onPress={() => analyzeMutation.mutate()}
          disabled={photos.length === 0 || analyzeMutation.isPending}
          style={[styles.primaryButton, photos.length === 0 && styles.primaryButtonDisabled]}
        >
          {analyzeMutation.isPending ? (
            <View style={styles.buttonRow}>
              <ActivityIndicator color={BG} />
              <Text style={styles.primaryButtonText}>Analysiere Fotos …</Text>
            </View>
          ) : (
            <Text style={[styles.primaryButtonText, photos.length === 0 && styles.primaryButtonTextDisabled]}>
              Artikel erkennen
            </Text>
          )}
        </Pressable>
      )}

      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      {items && resultMeta && (
        <View style={styles.results}>
          {resultMeta.staging_hint && (
            <View style={styles.hintBox}>
              <Text style={styles.hintText}>{resultMeta.staging_hint}</Text>
            </View>
          )}

          {resultMeta.multi_item_detected && resultMeta.bundle_recommendation && (
            <View style={styles.bundleCard}>
              <Text style={styles.bundleTitle}>{items.length} Artikel erkannt</Text>
              <Text style={styles.bundleReasoning}>{resultMeta.bundle_recommendation.reasoning}</Text>
              <Text style={styles.bundleDecision}>
                {resultMeta.bundle_recommendation.recommended
                  ? `Empfehlung: als Bundle für ca. CHF ${resultMeta.bundle_recommendation.bundle_price_chf}`
                  : "Empfehlung: einzeln verkaufen"}
              </Text>

              {resultMeta.bundle_recommendation.recommended && resultMeta.bundle_recommendation.suggested_title && (
                <>
                  <Text style={styles.itemTitle}>{resultMeta.bundle_recommendation.suggested_title}</Text>
                  <Text style={styles.itemDescription}>{resultMeta.bundle_recommendation.suggested_description}</Text>

                  <HeroImageBlock
                    photos={photos}
                    suggestedTitle={resultMeta.bundle_recommendation.suggested_title}
                    priceChfMax={resultMeta.bundle_recommendation.bundle_price_chf ?? 0}
                  />

                  <Pressable onPress={handleExportBundle} style={styles.exportButton}>
                    <Text style={styles.exportButtonText}>Bundle für Tutti / Ricardo / eBay exportieren</Text>
                  </Pressable>

                  <EbayDraftBlock
                    item={{
                      suggested_title: resultMeta.bundle_recommendation.suggested_title,
                      suggested_description: resultMeta.bundle_recommendation.suggested_description ?? "",
                      estimated_price_chf_max: resultMeta.bundle_recommendation.bundle_price_chf ?? 0,
                      category: resultMeta.bundle_recommendation.category ?? "",
                    }}
                    photos={photos}
                    isLoggedIn={Boolean(user)}
                  />
                </>
              )}
            </View>
          )}

          {items.map((item, index) => (
            <ItemCard
              key={`${item.name}-${index}`}
              item={item}
              isRefining={refiningIndex === index}
              answeredChips={answeredChips}
              itemIndex={index}
              refinementNote={refinementNotes[index]}
              onAnswerChip={handleAnswerChip}
              onExport={handleExport}
              photos={photos}
              isLoggedIn={Boolean(user)}
            />
          ))}

          <Text style={styles.finalDisclaimer}>{resultMeta.disclaimer}</Text>

          <Pressable onPress={reset} style={styles.resetButton}>
            <Text style={styles.resetButtonText}>Neue Fotos analysieren</Text>
          </Pressable>
        </View>
      )}
      </View>
    </ScrollView>
  );
}

function ItemCard({
  item,
  itemIndex,
  isRefining,
  answeredChips,
  refinementNote,
  onAnswerChip,
  onExport,
  photos,
  isLoggedIn,
}: {
  item: AnalyzedItem;
  itemIndex: number;
  isRefining: boolean;
  answeredChips: Record<string, string>;
  refinementNote?: string;
  onAnswerChip: (itemIndex: number, question: string, option: string) => void;
  onExport: (item: AnalyzedItem) => void;
  photos: ImagePicker.ImagePickerAsset[];
  isLoggedIn: boolean;
}) {
  // Nur übernehmen, wenn die KI einen validen Index in den TATSÄCHLICH
  // hochgeladenen Fotos angegeben hat - sonst Fallback auf Foto 0 ohne Crop
  // (bisheriges Verhalten), statt auf einen falschen Bildausschnitt zuzugreifen.
  const hasValidSourceIndex =
    item.source_photo_index !== null && item.source_photo_index >= 0 && item.source_photo_index < photos.length;
  const heroDefaults = {
    sourceIndex: hasValidSourceIndex ? item.source_photo_index! : 0,
    boundingBox: hasValidSourceIndex ? item.bounding_box : null,
  };

  return (
    <View style={styles.itemCard}>
      <Text style={styles.itemMeta}>
        {item.category} · {item.condition_guess}
        {item.possible_collector_value ? " · möglicher Sammlerwert" : ""}
      </Text>
      <Text style={styles.itemTitle}>{item.suggested_title}</Text>
      <Text style={styles.itemDescription}>{item.suggested_description}</Text>

      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.priceBadgeText}>
            CHF {item.estimated_price_chf_min}–{item.estimated_price_chf_max}
          </Text>
        </View>
        <View style={styles.badge}>
          <Text style={[styles.badgeText, { color: scoreColor(item.sell_score) }]}>Score {item.sell_score}/10</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>~{item.estimated_days_to_sell} Tage</Text>
        </View>
      </View>

      <Text style={styles.seasonText}>
        Bester Verkaufszeitraum: {item.best_selling_period.period} – {item.best_selling_period.reasoning}
      </Text>

      {item.platform_recommendation && (
        <Text style={styles.platformHintText}>
          💡 Eignet sich gut für {PLATFORM_RECOMMENDATION_LABELS[item.platform_recommendation.platform]}:{" "}
          {item.platform_recommendation.reasoning}
        </Text>
      )}

      {item.possible_collector_value && (
        <CollectorValueBlock
          name={item.name}
          category={item.category}
          conditionGuess={item.condition_guess}
          estimatedPriceChfMin={item.estimated_price_chf_min}
          estimatedPriceChfMax={item.estimated_price_chf_max}
        />
      )}

      <HeroImageBlock
        photos={photos}
        suggestedTitle={item.suggested_title}
        priceChfMax={item.estimated_price_chf_max}
        conditionGuess={item.condition_guess}
        defaultSourceIndex={heroDefaults.sourceIndex}
        defaultBoundingBox={heroDefaults.boundingBox}
      />

      {item.missing_photo_suggestions.length > 0 && (
        <View style={styles.missingPhotos}>
          <Text style={styles.missingPhotosLabel}>Noch fotografieren:</Text>
          {item.missing_photo_suggestions.map((suggestion, i) => (
            <Text key={i} style={styles.missingPhotoItem}>
              • {suggestion}
            </Text>
          ))}
        </View>
      )}

      {item.clarifying_questions.length > 0 && (
        <View style={styles.clarifyingBlock}>
          {item.clarifying_questions.map((q) => (
            <View key={q.question} style={styles.clarifyingQuestion}>
              <Text style={styles.clarifyingQuestionText}>{q.question}</Text>
              <View style={styles.chipRow}>
                {q.options.map((option) => {
                  const selected = answeredChips[`${itemIndex}-${q.question}`] === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => onAnswerChip(itemIndex, q.question, option)}
                      disabled={isRefining}
                      style={[styles.chip, selected && styles.chipSelected]}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {isRefining && <ActivityIndicator color={ACCENT} style={{ marginTop: 4 }} />}
          {refinementNote && <Text style={styles.refinementNote}>{refinementNote}</Text>}
        </View>
      )}

      <Pressable onPress={() => onExport(item)} style={styles.exportButton}>
        <Text style={styles.exportButtonText}>Für Tutti / Ricardo / eBay exportieren</Text>
      </Pressable>

      <EbayDraftBlock item={item} photos={photos} isLoggedIn={isLoggedIn} />
    </View>
  );
}

const CONFIDENCE_LABELS: Record<CollectorValueResult["confidence"], string> = {
  low: "Niedrige Verlässlichkeit",
  medium: "Mittlere Verlässlichkeit",
  high: "Hohe Verlässlichkeit",
};

function CollectorValueBlock({
  name,
  category,
  conditionGuess,
  estimatedPriceChfMin,
  estimatedPriceChfMax,
}: {
  name: string;
  category: string;
  conditionGuess: string;
  estimatedPriceChfMin: number;
  estimatedPriceChfMax: number;
}) {
  const mutation = useMutation({
    mutationFn: () =>
      researchCollectorValue({
        name,
        category,
        condition_guess: conditionGuess,
        current_estimate: {
          estimated_price_chf_min: estimatedPriceChfMin,
          estimated_price_chf_max: estimatedPriceChfMax,
        },
      }),
  });

  const errorMessage =
    mutation.error instanceof ApiRequestError
      ? mutation.error.message
      : mutation.error
        ? "Recherche fehlgeschlagen. Bitte nochmals versuchen."
        : null;

  if (mutation.data) {
    const result = mutation.data;
    return (
      <View style={styles.collectorBox}>
        <View style={styles.collectorHeaderRow}>
          <Text style={styles.collectorTitle}>Sammlerwert-Recherche</Text>
          <Text style={[styles.collectorConfidence, { color: confidenceColor(result.confidence) }]}>
            {CONFIDENCE_LABELS[result.confidence]}
          </Text>
        </View>
        <Text style={[styles.collectorScore, { color: scoreColor(result.collector_value_score) }]}>
          Sammlerwert-Score {result.collector_value_score}/10
        </Text>
        <Text style={styles.collectorReasoning}>{result.reasoning}</Text>
        <Text style={styles.collectorPrice}>
          Angepasste Preisspanne: CHF {result.adjusted_price_chf_min}–{result.adjusted_price_chf_max}
        </Text>
        <Text style={styles.collectorVenue}>
          Empfohlener Verkaufsort: {result.sales_venue_recommendation.recommended_venue} –{" "}
          {result.sales_venue_recommendation.reasoning}
        </Text>
        {result.sources.length > 0 && (
          <View style={styles.collectorSources}>
            <Text style={styles.collectorSourcesLabel}>Quellen:</Text>
            {result.sources.map((source, i) => (
              <Pressable key={i} onPress={() => Linking.openURL(source.url)}>
                <Text style={styles.collectorSourceLink}>• {source.title || source.url}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.collectorDisclaimer}>{result.disclaimer}</Text>
      </View>
    );
  }

  return (
    <View style={styles.collectorBox}>
      <Pressable
        onPress={() => mutation.mutate()}
        disabled={mutation.isPending}
        style={[styles.collectorButton, mutation.isPending && styles.collectorButtonDisabled]}
      >
        {mutation.isPending ? (
          <View style={styles.buttonRow}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.collectorButtonText}>Recherchiere im Web …</Text>
          </View>
        ) : (
          <Text style={styles.collectorButtonText}>Möglicher Sammlerwert – Recherche starten</Text>
        )}
      </Pressable>
      {errorMessage && <Text style={styles.collectorErrorText}>{errorMessage}</Text>}
    </View>
  );
}

function HeroImageBlock({
  photos,
  suggestedTitle,
  priceChfMax,
  conditionGuess,
  defaultSourceIndex = 0,
  defaultBoundingBox = null,
}: {
  photos: ImagePicker.ImagePickerAsset[];
  suggestedTitle: string;
  priceChfMax: number;
  conditionGuess?: string;
  defaultSourceIndex?: number;
  defaultBoundingBox?: BoundingBox | null;
}) {
  const [sourceIndex, setSourceIndex] = useState(defaultSourceIndex);
  // Die Box gilt nur für das KI-vorgeschlagene Foto (defaultSourceIndex).
  // Wählt der Nutzer manuell ein anderes Foto über den Thumbnail-Picker,
  // ist die Box dafür nicht mehr gültig -> auf "kein Crop" zurücksetzen,
  // statt die alte Box auf das falsche Foto anzuwenden.
  const [boundingBox, setBoundingBox] = useState<BoundingBox | null>(defaultBoundingBox);

  const handleManualSourceSelect = (i: number) => {
    setSourceIndex(i);
    setBoundingBox(null);
  };

  const composingMutation = useMutation({
    mutationFn: () => composeHeroImage(photos[sourceIndex], boundingBox),
  });
  const marketingMutation = useMutation({
    mutationFn: () =>
      composeMarketingHeroImage(
        photos[sourceIndex],
        {
          title: suggestedTitle,
          price_chf: Math.round(priceChfMax),
          condition_guess: conditionGuess,
        },
        boundingBox
      ),
  });

  const composingErrorMessage =
    composingMutation.error instanceof ApiRequestError
      ? composingMutation.error.message
      : composingMutation.error
        ? "Titelfoto konnte nicht erstellt werden. Bitte nochmals versuchen."
        : null;
  const marketingErrorMessage =
    marketingMutation.error instanceof ApiRequestError
      ? marketingMutation.error.message
      : marketingMutation.error
        ? "Titelbild konnte nicht erstellt werden. Bitte nochmals versuchen."
        : null;

  if (photos.length === 0) return null;

  return (
    <View style={styles.heroBox}>
      <Text style={styles.heroTitle}>Titelfoto</Text>

      {photos.length > 1 && (
        <View style={styles.heroSourceRow}>
          {photos.map((photo, i) => (
            <Pressable key={photo.assetId ?? photo.uri ?? i} onPress={() => handleManualSourceSelect(i)}>
              <Image
                source={{ uri: photo.uri }}
                style={[styles.heroSourceThumb, i === sourceIndex && styles.heroSourceThumbSelected]}
              />
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.heroButtonRow}>
        <Pressable
          onPress={() => composingMutation.mutate()}
          disabled={composingMutation.isPending}
          style={[styles.heroButton, composingMutation.isPending && styles.collectorButtonDisabled]}
        >
          {composingMutation.isPending ? (
            <ActivityIndicator color={ACCENT} />
          ) : (
            <Text style={styles.heroButtonText}>Freisteller erstellen</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => marketingMutation.mutate()}
          disabled={marketingMutation.isPending}
          style={[styles.heroButton, marketingMutation.isPending && styles.collectorButtonDisabled]}
        >
          {marketingMutation.isPending ? (
            <ActivityIndicator color={ACCENT} />
          ) : (
            <Text style={styles.heroButtonText}>Marketing-Titelbild</Text>
          )}
        </Pressable>
      </View>

      {composingErrorMessage && <Text style={styles.collectorErrorText}>{composingErrorMessage}</Text>}
      {composingMutation.data && (
        <View style={styles.heroResult}>
          <Image
            source={{ uri: `data:${composingMutation.data.media_type};base64,${composingMutation.data.image_base64}` }}
            style={styles.heroResultImage}
          />
          <Pressable onPress={() => composingMutation.mutate()}>
            <Text style={styles.heroRegenerateText}>Neu erstellen</Text>
          </Pressable>
        </View>
      )}

      {marketingErrorMessage && <Text style={styles.collectorErrorText}>{marketingErrorMessage}</Text>}
      {marketingMutation.data && (
        <View style={styles.heroResult}>
          <Image
            source={{ uri: `data:${marketingMutation.data.media_type};base64,${marketingMutation.data.image_base64}` }}
            style={styles.heroResultImage}
          />
          <Pressable onPress={() => marketingMutation.mutate()}>
            <Text style={styles.heroRegenerateText}>Neu erstellen</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Absichtlich ein minimaler struktureller Typ statt AnalyzedItem: dieser
// Block liest nur diese 5 Felder (siehe draftMutation unten) und soll auch
// von einem synthetisierten Bundle-Objekt (kein echtes AnalyzedItem)
// verwendet werden können.
type EbayDraftItemInput = {
  suggested_title: string;
  suggested_description: string;
  estimated_price_chf_max: number;
  category: string;
  condition_guess?: string;
};

function EbayDraftBlock({
  item,
  photos,
  isLoggedIn,
}: {
  item: EbayDraftItemInput;
  photos: ImagePicker.ImagePickerAsset[];
  isLoggedIn: boolean;
}) {
  const statusQuery = useQuery({
    queryKey: ["ebay-status"],
    queryFn: getEbayStatus,
    enabled: isLoggedIn,
  });

  const draftMutation = useMutation({
    mutationFn: () =>
      createEbayDraft(
        {
          title: item.suggested_title,
          description: item.suggested_description,
          price_chf: Math.round(item.estimated_price_chf_max),
          category: item.category,
          condition_guess: item.condition_guess,
        },
        photos
      ),
  });

  const draftErrorMessage =
    draftMutation.error instanceof ApiRequestError
      ? draftMutation.error.message
      : draftMutation.error
        ? "eBay-Entwurf konnte nicht erstellt werden. Bitte nochmals versuchen."
        : null;

  if (!isLoggedIn) {
    return (
      <View style={styles.ebayBox}>
        <Text style={styles.ebayHintText}>
          Für einen eBay-Entwurf zuerst{" "}
          <Text style={styles.ebayHintLink} onPress={() => router.push("/login")}>
            anmelden
          </Text>
          .
        </Text>
      </View>
    );
  }

  if (statusQuery.isPending) {
    return (
      <View style={styles.ebayBox}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (!statusQuery.data?.connected) {
    return (
      <View style={styles.ebayBox}>
        <Text style={styles.ebayHintText}>
          Für einen eBay-Entwurf zuerst{" "}
          <Text style={styles.ebayHintLink} onPress={() => router.push("/ebay")}>
            eBay-Konto verknüpfen
          </Text>
          .
        </Text>
      </View>
    );
  }

  if (draftMutation.data) {
    const result = draftMutation.data;
    return (
      <View style={styles.ebayBox}>
        <View style={styles.ebayResultBox}>
          <Text style={styles.ebayResultTitle}>
            eBay-Entwurf angelegt · {result.ebay_environment === "SANDBOX" ? "Sandbox" : "Produktiv"}
          </Text>
          <Text style={styles.ebayResultDetail}>Kategorie: {result.category_used.name}</Text>
          <Text style={styles.ebayResultDetail}>SKU: {result.sku}</Text>
          <Text style={styles.ebayResultNote}>{result.note}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.ebayBox}>
      <Pressable
        onPress={() => draftMutation.mutate()}
        disabled={draftMutation.isPending}
        style={[styles.ebayButton, draftMutation.isPending && styles.collectorButtonDisabled]}
      >
        {draftMutation.isPending ? (
          <View style={styles.buttonRow}>
            <ActivityIndicator color={TEAL} />
            <Text style={styles.ebayButtonText}>Lege Entwurf an …</Text>
          </View>
        ) : (
          <Text style={styles.ebayButtonText}>Als eBay-Entwurf anlegen</Text>
        )}
      </Pressable>
      {draftErrorMessage && <Text style={styles.collectorErrorText}>{draftErrorMessage}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  scrollContent: { flexGrow: 1, alignItems: "center" },
  content: { maxWidth: 480, width: "100%", padding: 16, paddingBottom: 48 },
  header: { marginBottom: 16 },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: CARD,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  accountText: { color: MUTED, fontSize: 12.5 },
  accountActions: { flexDirection: "row", gap: 16 },
  accountAction: { color: ACCENT, fontSize: 12.5, fontWeight: "700" },
  kicker: { color: MUTED, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase" },
  title: { color: TEXT, fontSize: 28, fontWeight: "700", marginTop: 6, marginBottom: 4 },
  subtitle: { color: MUTED, fontSize: 14 },
  disclaimerBox: {
    backgroundColor: "rgba(212,160,23,0.1)",
    borderColor: "rgba(212,160,23,0.35)",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  disclaimerText: { color: TEXT, fontSize: 12.5, lineHeight: 18 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  photoTile: { width: "23%", aspectRatio: 1, borderRadius: 10, overflow: "hidden", position: "relative" },
  photoImage: { width: "100%", height: "100%" },
  removeButton: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 999,
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  removeButtonText: { color: "#fff", fontSize: 14, lineHeight: 16 },
  addTile: {
    width: "23%",
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: MUTED,
    borderStyle: "dashed",
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  addTileText: { color: MUTED, fontSize: 11, textAlign: "center" },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonDisabled: { backgroundColor: "#3A382F" },
  primaryButtonText: { color: BG, fontWeight: "700", fontSize: 15 },
  primaryButtonTextDisabled: { color: MUTED },
  buttonRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { color: "#E08A6F", fontSize: 13, marginTop: 12 },
  results: { marginTop: 22 },
  hintBox: {
    backgroundColor: CARD,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: ACCENT,
  },
  hintText: { color: TEXT, fontSize: 13, lineHeight: 18 },
  bundleCard: { backgroundColor: CARD, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#3A382F" },
  bundleTitle: { color: TEXT, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  bundleReasoning: { color: TEXT, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  bundleDecision: { color: TEAL, fontSize: 13, fontWeight: "700" },
  itemCard: { backgroundColor: CARD, borderRadius: 14, padding: 16, marginBottom: 14 },
  itemMeta: { color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  itemTitle: { color: TEXT, fontSize: 18, fontWeight: "600", marginBottom: 6 },
  itemDescription: { color: TEXT, fontSize: 13.5, lineHeight: 20, marginBottom: 12 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  badge: { backgroundColor: BG, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  priceBadgeText: { color: ACCENT, fontSize: 18, fontWeight: "700" },
  badgeText: { color: TEXT, fontSize: 13, fontWeight: "600" },
  seasonText: { color: MUTED, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  platformHintText: { color: TEAL, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  collectorBox: { marginBottom: 12 },
  collectorButton: {
    borderWidth: 1,
    borderColor: ACCENT,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  collectorButtonDisabled: { opacity: 0.6 },
  collectorButtonText: { color: ACCENT, fontSize: 12.5, fontWeight: "700" },
  collectorErrorText: { color: "#E08A6F", fontSize: 12, marginTop: 6 },
  collectorHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  collectorTitle: { color: TEXT, fontSize: 13.5, fontWeight: "700" },
  collectorConfidence: { fontSize: 11, fontWeight: "600" },
  collectorScore: { fontSize: 13, fontWeight: "700", marginBottom: 4 },
  collectorReasoning: { color: TEXT, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  collectorPrice: { color: ACCENT, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  collectorVenue: { color: TEXT, fontSize: 12.5, lineHeight: 18, marginBottom: 8 },
  collectorSources: { marginBottom: 8, gap: 3 },
  collectorSourcesLabel: { color: MUTED, fontSize: 11.5, marginBottom: 2 },
  collectorSourceLink: { color: TEAL, fontSize: 12.5, textDecorationLine: "underline" },
  collectorDisclaimer: { color: MUTED, fontSize: 10.5, lineHeight: 15 },
  heroBox: { marginBottom: 12 },
  heroTitle: { color: TEXT, fontSize: 13.5, fontWeight: "700", marginBottom: 8 },
  heroSourceRow: { flexDirection: "row", gap: 6, marginBottom: 8 },
  heroSourceThumb: { width: 44, height: 44, borderRadius: 8, opacity: 0.5 },
  heroSourceThumbSelected: { opacity: 1, borderWidth: 2, borderColor: ACCENT },
  heroButtonRow: { flexDirection: "row", gap: 8 },
  heroButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: TEAL,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  heroButtonText: { color: TEAL, fontSize: 12.5, fontWeight: "700" },
  heroResult: { marginTop: 12, alignItems: "center" },
  heroResultImage: { width: "100%", aspectRatio: 1, borderRadius: 10, backgroundColor: BG },
  heroRegenerateText: { color: ACCENT, fontSize: 12, fontWeight: "600", marginTop: 8 },
  missingPhotos: { marginBottom: 12 },
  missingPhotosLabel: { color: MUTED, fontSize: 11.5, marginBottom: 4 },
  missingPhotoItem: { color: TEXT, fontSize: 12.5, lineHeight: 18 },
  clarifyingBlock: { marginTop: 4, gap: 10 },
  clarifyingQuestion: { gap: 6 },
  clarifyingQuestionText: { color: TEXT, fontSize: 13, fontWeight: "600" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: MUTED,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipSelected: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { color: TEXT, fontSize: 12.5 },
  chipTextSelected: { color: BG, fontWeight: "700" },
  refinementNote: { color: TEAL, fontSize: 12, marginTop: 4, lineHeight: 17 },
  exportButton: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  exportButtonText: { color: ACCENT, fontSize: 13, fontWeight: "700" },
  ebayBox: { marginTop: 10 },
  ebayHintText: { color: MUTED, fontSize: 12, lineHeight: 17 },
  ebayHintLink: { color: ACCENT, fontWeight: "700" },
  ebayButton: {
    borderWidth: 1,
    borderColor: TEAL,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  ebayButtonText: { color: TEAL, fontSize: 13, fontWeight: "700" },
  ebayResultBox: { backgroundColor: BG, borderRadius: 10, padding: 12 },
  ebayResultTitle: { color: TEAL, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  ebayResultDetail: { color: TEXT, fontSize: 12.5, marginBottom: 3 },
  ebayResultNote: { color: MUTED, fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  finalDisclaimer: { color: MUTED, fontSize: 11, textAlign: "center", marginTop: 4, marginBottom: 14, lineHeight: 16 },
  resetButton: { alignItems: "center", paddingVertical: 11 },
  resetButtonText: { color: MUTED, fontSize: 13 },
});
