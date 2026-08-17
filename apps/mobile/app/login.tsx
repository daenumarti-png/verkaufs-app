import React, { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { firebaseAuth, googleAuthProvider } from "../lib/firebase";
import { completeGoogleSignIn, completeAppleSignIn, registerWithEmail, loginWithEmail } from "../lib/auth";
import { ACCENT, BG, CARD, TEXT, MUTED } from "../constants/theme";

// Nötig, damit der Browser-Redirect nach dem Google-Login sauber zur App
// zurückfindet (Web + native Browser-Session-Flows).
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

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

  // Web nutzt Firebase Authentication statt expo-auth-session: Firebase
  // verwaltet autorisierte Domains automatisch (Popup-Redirect läuft über
  // die eigene, von Firebase verwaltete authDomain) - kein manuelles
  // OAuth-redirect_uri-Konfigurieren mehr nötig, das war die Ursache des
  // bisherigen "redirect_uri_mismatch"-Fehlers auf der deployten Web-App.
  // Nativ (Expo Go) bleibt beim bisherigen expo-auth-session-Flow, da
  // Firebase JS SDKs Popup/Redirect-Login ausschliesslich im Browser
  // unterstützt - der Response kommt dort weiterhin über den obigen
  // useEffect (response?.type) rein.
  const handleGoogleSignIn = () => {
    setError(null);
    if (Platform.OS === "web") {
      void signInWithGoogleOnWeb();
    } else {
      promptAsync();
    }
  };

  const signInWithGoogleOnWeb = async () => {
    setLoading("google");
    try {
      const result = await signInWithPopup(firebaseAuth, googleAuthProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.idToken) throw new Error("Kein Google-Token erhalten.");
      await completeGoogleSignIn(credential.idToken);
      router.back();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // Nutzer hat das Popup selbst geschlossen/abgebrochen - kein Fehler,
      // den man anzeigen müsste.
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setError(err instanceof Error ? err.message : "Google-Anmeldung fehlgeschlagen.");
      }
    } finally {
      setLoading(null);
    }
  };

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

  const handleEmailSubmit = async () => {
    setError(null);
    const trimmedEmail = emailInput.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    if (passwordInput.length < (mode === "register" ? 8 : 1)) {
      setError("Das Passwort muss mindestens 8 Zeichen haben.");
      return;
    }
    setEmailLoading(true);
    try {
      if (mode === "register") {
        await registerWithEmail(trimmedEmail, passwordInput, nameInput.trim() || undefined);
      } else {
        await loginWithEmail(trimmedEmail, passwordInput);
      }
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Anmelden</Text>
        <Text style={styles.subtitle}>
          Mit Konto: unbegrenzt Artikel erkennen, eigene Verkaufshistorie, eBay-Verknüpfung möglich. Im
          Gastmodus sind es bis zu 5 Artikel.
        </Text>

        <Pressable
          onPress={handleGoogleSignIn}
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

        <View style={styles.divider}>
          <Text style={styles.dividerText}>oder</Text>
        </View>

        {mode === "register" && (
          <TextInput
            style={styles.input}
            placeholder="Name (optional)"
            placeholderTextColor={MUTED}
            value={nameInput}
            onChangeText={setNameInput}
            autoCapitalize="words"
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="E-Mail"
          placeholderTextColor={MUTED}
          value={emailInput}
          onChangeText={setEmailInput}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <TextInput
          style={styles.input}
          placeholder="Passwort"
          placeholderTextColor={MUTED}
          value={passwordInput}
          onChangeText={setPasswordInput}
          secureTextEntry
          textContentType={mode === "register" ? "newPassword" : "password"}
        />

        <Pressable
          onPress={handleEmailSubmit}
          disabled={loading !== null || emailLoading}
          style={[styles.emailButton, (loading !== null || emailLoading) && styles.buttonDisabled]}
        >
          {emailLoading ? (
            <ActivityIndicator color={BG} />
          ) : (
            <Text style={styles.emailButtonText}>{mode === "register" ? "Konto erstellen" : "Anmelden"}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          style={styles.toggleButton}
        >
          <Text style={styles.toggleButtonText}>
            {mode === "login" ? "Noch kein Konto? Registrieren" : "Bereits ein Konto? Anmelden"}
          </Text>
        </Pressable>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable onPress={() => router.back()} style={styles.guestButton}>
          <Text style={styles.guestButtonText}>Als Gast fortfahren</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 16 },
  dividerText: { color: MUTED, fontSize: 12, textAlign: "center", width: "100%" },
  input: {
    backgroundColor: CARD,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: MUTED,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: TEXT,
    fontSize: 15,
    marginBottom: 10,
  },
  emailButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 12,
  },
  emailButtonText: { color: BG, fontWeight: "700", fontSize: 15 },
  toggleButton: { alignItems: "center", paddingVertical: 8 },
  toggleButtonText: { color: ACCENT, fontSize: 13, fontWeight: "600" },
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
