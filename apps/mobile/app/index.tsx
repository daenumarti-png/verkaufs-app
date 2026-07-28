import { StyleSheet, Text, View } from "react-native";

// Platzhalter-Screen für Phase 1 (Setup). Der eigentliche Foto-Upload- und
// Analyse-Flow aus dem Prototyp (verkaufs-app-prototyp.jsx) wird ab Phase 2
// gegen das serverseitige Backend neu aufgebaut, nicht 1:1 client-seitig kopiert.
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verkaufs-Assistent</Text>
      <Text style={styles.subtitle}>Grundgerüst steht. Foto-Analyse folgt in Phase 2.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1C1B19",
    padding: 24,
  },
  title: {
    color: "#EDE8DF",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    color: "#8A857A",
    fontSize: 14,
    textAlign: "center",
  },
});
