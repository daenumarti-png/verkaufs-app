import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Nur für den WEB-Login genutzt (siehe login.tsx) – ersetzt den fragilen
// manuellen OAuth-redirect_uri-Flow (expo-auth-session) auf Web durch
// Firebase Authentication, das autorisierte Domains automatisch verwaltet.
// Native (Expo Go) nutzt weiterhin expo-auth-session, da Firebase JS SDKs
// signInWithPopup/signInWithRedirect ausschliesslich im Browser funktioniert.
// Diese Werte sind kein Geheimnis (stehen bei jeder Firebase-Web-App offen
// im Code) – Schutz kommt über Firebase-Auth-Regeln + das eigene
// Backend-JWT danach (siehe routes/auth.ts), nicht über Geheimhaltung.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// getApps()-Check statt einfach initializeApp(): Expo Webs Fast-Refresh lädt
// dieses Modul beim Entwickeln mehrfach neu – ein zweiter initializeApp()-
// Aufruf mit demselben Namen wirft sonst "Firebase App named '[DEFAULT]'
// already exists".
export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const googleAuthProvider = new GoogleAuthProvider();
