import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// expo-secure-store unterstützt kein Web (nötig für die Expo-Web-Vorschau
// während der Entwicklung) – daher ein schlanker plattformabhängiger
// Wrapper: SecureStore nativ, localStorage im Web.
export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
