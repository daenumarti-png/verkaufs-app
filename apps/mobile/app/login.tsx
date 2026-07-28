import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { router } from "expo-router";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { completeGoogleSignIn, completeAppleSignIn } from "../lib/auth";
import { ACCENT, BG, CARD, TEXT, MUTED } from "../constants/theme";

// Nötig, damit der Browser-Redirect nach dem Google-Login sauber zur App
// zurückfindet (Web + native Browser-Session-Flows).
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
  });

  useEffect(() => {
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
    }
  }, []);

  useEffect(() => {
    if (response?.type === "success" && response.params.id_token) {
      setLoading("google");
      setError(null);
      completeGoogleSignIn(response.params.id_token)
        .then(() => router.back())
        .catch((err) => setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen."))
        .finally(() => setLoading(null));
    } else if (response?.type === "error") {
      setError("Google-Anmeldung fehlgeschlagen oder abgebrochen.");
    }
  }, [response]);

  const handleAppleSignIn = async () => {
    setError(null);
    setLoading("apple");
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error("Kein Apple-Token erhalten.");
      // Apple liefert den Namen nur beim allerersten Sign-in – danach ist er
      // bereits in unserer DB gespeichert (siehe Backend Phase 10).
      const fullName = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(" ")
        : undefined;
      await completeAppleSignIn(credential.identityToken, fullName || undefined);
      router.back();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "ERR_REQUEST_CANCELED") {
        setError(err instanceof Error ? err.message : "Apple-Anmeldung fehlgeschlagen.");
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.title}>Anmelden</Text>
        <Text style={styles.subtitle}>
          Mit Konto: unbegrenzt Artikel erkennen, eigene Verkaufshistorie, eBay-Verknüpfung möglich. Im
          Gastmodus sind es bis zu 5 Artikel.
        </Text>

        <Pressable
          onPress={() => {
            setError(null);
            promptAsync();
          }}
          disabled={!request || loading !== null}
          style={[styles.googleButton, (!request || loading !== null) && styles.buttonDisabled]}
        >
          {loading === "google" ? (
            <ActivityIndicator color={BG} />
          ) : (
            <Text style={styles.googleButtonText}>Mit Google anmelden</Text>
          )}
        </Pressable>

        {appleAvailable && (
          <Pressable
            onPress={handleAppleSignIn}
            disabled={loading !== null}
            style={[styles.appleButton, loading !== null && styles.buttonDisabled]}
          >
            {loading === "apple" ? (
              <ActivityIndicator color={TEXT} />
            ) : (
              <Text style={styles.appleButtonText}>Mit Apple anmelden</Text>
            )}
          </Pressable>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable onPress={() => router.back()} style={styles.guestButton}>
          <Text style={styles.guestButtonText}>Als Gast fortfahren</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
  content: { width: "100%", maxWidth: 420, padding: 24 },
  title: { color: TEXT, fontSize: 26, fontWeight: "700", marginBottom: 10, textAlign: "center" },
  subtitle: { color: MUTED, fontSize: 13.5, lineHeight: 20, marginBottom: 28, textAlign: "center" },
  googleButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 12,
  },
  googleButtonText: { color: BG, fontWeight: "700", fontSize: 15 },
  appleButton: {
    backgroundColor: TEXT,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 12,
  },
  appleButtonText: { color: BG, fontWeight: "700", fontSize: 15 },
  buttonDisabled: { opacity: 0.5 },
  errorText: { color: "#E08A6F", fontSize: 13, textAlign: "center", marginBottom: 12 },
  guestButton: { alignItems: "center", paddingVertical: 12, marginTop: 8 },
  guestButtonText: { color: MUTED, fontSize: 13.5 },
});
