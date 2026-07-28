import React, { useState, useRef } from "react";
import { Camera, X, Loader2, Tag, TrendingUp, Clock, Layers, AlertCircle, Check, Upload } from "lucide-react";

const ACCENT = "#D4A017"; // Preis-Senf
const TEAL = "#4A7A6D"; // Sold/Score-Grün
const BG = "#1C1B19";
const CARD = "#26241F";
const TEXT = "#EDE8DF";
const MUTED = "#8A857A";

function fileToJpegBase64(file, maxDim = 1568, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve({ base64: dataUrl.split(",")[1], previewUrl: dataUrl });
        } catch (e) {
          reject(new Error("Foto konnte nicht verarbeitet werden"));
        }
      };
      img.onerror = () => {
        reject(new Error("Format wird nicht unterstützt (z.B. HEIC). Bitte als JPEG/PNG speichern und erneut versuchen."));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function repairTruncatedJson(text) {
  let inString = false;
  let escape = false;
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let repaired = text;
  if (inString) repaired += '"';
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === "{" ? "}" : "]";
  }
  return repaired;
}

function scoreColor(score) {
  if (score >= 7) return TEAL;
  if (score >= 4) return ACCENT;
  return "#B5533C";
}

export default function App() {
  const [photos, setPhotos] = useState([]); // {file, base64, mediaType, previewUrl}
  const [status, setStatus] = useState("idle"); // idle | analyzing | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const inputRef = useRef(null);
  const uploadRef = useRef(null);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList).slice(0, 4 - photos.length);
    const newPhotos = [];
    const failedNames = [];
    for (const file of files) {
      try {
        const { base64, previewUrl } = await fileToJpegBase64(file);
        newPhotos.push({ base64, mediaType: "image/jpeg", previewUrl });
      } catch (e) {
        failedNames.push(file.name || "Foto");
      }
    }
    setPhotos((p) => [...p, ...newPhotos].slice(0, 4));
    if (failedNames.length > 0) {
      setErrorMsg(`Konnte nicht verarbeitet werden: ${failedNames.join(", ")}`);
    }
  };

  const removePhoto = (idx) => {
    setPhotos((p) => p.filter((_, i) => i !== idx));
  };

  const analyze = async () => {
    if (photos.length === 0) return;
    setStatus("analyzing");
    setErrorMsg("");
    setResult(null);

    const promptText = `Du bist ein Experte für den Verkauf gebrauchter Gegenstände auf Schweizer Occasion-Plattformen (Tutti.ch, Ricardo.ch) und eBay.
Dir werden ${photos.length} Foto(s) desselben Verkaufsvorgangs gezeigt. Wichtig: Diese Fotos können entweder verschiedene, unterschiedliche Artikel zeigen (z.B. mehrere Videospiele nebeneinander), ODER denselben Artikel/dieselbe Artikelgruppe aus mehreren Blickwinkeln bzw. als Nahaufnahme (z.B. ein Gruppenfoto plus Einzel-Nahaufnahmen derselben Gegenstände). Erkenne zuerst, ob es sich um dieselben Objekte auf mehreren Fotos handelt, und führe diese dann zu EINEM Eintrag pro echtem, unterschiedlichem Artikel zusammen – zähle keinen Artikel doppelt, nur weil er auf mehreren Fotos zu sehen ist. Nutze Nahaufnahmen nur, um Zustand/Details eines bereits erkannten Artikels genauer einzuschätzen.
Maximal 3 unterschiedliche Artikel im Ergebnis.

Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt, ohne Erklärtext, ohne Markdown-Codeblock, exakt in diesem Schema:
{
  "items": [
    {
      "name": "kurzer Objektname",
      "category": "Kategorie",
      "condition_guess": "Zustand in 1-3 Worten",
      "suggested_title": "verkaufsfertiger Inseratetitel, max 45 Zeichen",
      "suggested_description": "Verkaufstext, max 15 Wörter",
      "estimated_price_chf_min": Zahl,
      "estimated_price_chf_max": Zahl,
      "sell_score": Zahl von 1 bis 10,
      "estimated_days_to_sell": Zahl,
      "missing_photo_suggestions": ["max 1 kurzer Tipp"]
    }
  ],
  "multi_item_detected": true oder false,
  "bundle_recommendation": {
    "recommended": true oder false,
    "reasoning": "max 12 Wörter",
    "bundle_price_chf": Zahl oder null
  }
}
Sehr wichtig: Fasse dich extrem knapp, jedes Textfeld so kurz wie möglich, da die Gesamtantwort ein striktes Token-Limit hat. Die Preisschätzung basiert nur auf allgemeinem Wissen, nicht auf Live-Marktdaten. Sei bei "sell_score" und "estimated_days_to_sell" realistisch.`;

    try {
      const content = [
        ...photos.map((p) => ({
          type: "image",
          source: { type: "base64", media_type: p.mediaType, data: p.base64 },
        })),
        { type: "text", text: promptText },
      ];

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content }],
        }),
      });

      if (!response.ok) throw new Error("API-Antwort nicht ok (" + response.status + ")");
      const data = await response.json();
      const textBlock = data.content.find((b) => b.type === "text");
      if (!textBlock) throw new Error("Keine Textantwort erhalten");

      const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
      let parsed;
      let wasTruncated = false;
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        parsed = JSON.parse(repairTruncatedJson(cleaned));
        wasTruncated = true;
      }
      if (parsed.items) {
        parsed.items = parsed.items.filter(
          (it) => it && it.suggested_title && typeof it.estimated_price_chf_min !== "undefined"
        );
      }
      if (!parsed.items || parsed.items.length === 0) {
        throw new Error("Antwort enthielt keine verwertbaren Artikel");
      }
      setResult(parsed);
      if (wasTruncated) {
        setErrorMsg("Hinweis: Die Antwort war sehr lang und wurde gekürzt — einzelne Angaben unten können unvollständig sein.");
      } else {
        setErrorMsg("");
      }
      setStatus("done");
    } catch (e) {
      setErrorMsg("Analyse fehlgeschlagen: " + e.message + ". Bitte nochmals versuchen.");
      setStatus("error");
    }
  };

  const saveDraft = async (item) => {
    try {
      const key = "draft:" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const res = await window.storage.set(key, JSON.stringify(item), false);
      if (res) setSavedCount((c) => c + 1);
    } catch (e) {
      // Speichern fehlgeschlagen — im Prototyp nur still ignorieren
    }
  };

  const reset = () => {
    setPhotos([]);
    setResult(null);
    setStatus("idle");
    setErrorMsg("");
  };

  return (
    <div style={{ background: BG, minHeight: "100vh", color: TEXT, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "20px 16px 48px" }}>
        {/* Header */}
        <header style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Tag size={20} color={ACCENT} />
            <span style={{ fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", color: MUTED }}>
              Verkaufs-Assistent · Testumgebung
            </span>
          </div>
          <h1
            style={{
              fontFamily: "'Fraunces', Georgia, serif",
              fontSize: 30,
              fontWeight: 600,
              margin: "6px 0 4px",
              lineHeight: 1.1,
            }}
          >
            Foto rein, Inserat raus.
          </h1>
          <p style={{ color: MUTED, fontSize: 14, margin: 0 }}>
            Bis zu 4 Fotos. Die KI erkennt Artikel, schätzt Preis, Score und Verkaufsdauer.
          </p>
        </header>

        {/* Disclaimer */}
        <div
          style={{
            background: "rgba(212,160,23,0.1)",
            border: "1px solid rgba(212,160,23,0.35)",
            borderRadius: 10,
            padding: "10px 12px",
            display: "flex",
            gap: 8,
            marginBottom: 18,
          }}
        >
          <AlertCircle size={16} color={ACCENT} style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 12.5, color: TEXT, margin: 0, lineHeight: 1.4 }}>
            Demo-Modus: Preis- und Score-Schätzung basiert auf allgemeinem KI-Wissen, noch nicht auf
            echten Tutti-/Ricardo-Verkaufsdaten. Kein Inserat wird veröffentlicht.
          </p>
        </div>

        {/* Photo grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
          {photos.map((p, idx) => (
            <div key={idx} style={{ position: "relative", aspectRatio: "1", borderRadius: 10, overflow: "hidden" }}>
              <img src={p.previewUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button
                onClick={() => removePhoto(idx)}
                aria-label="Foto entfernen"
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  background: "rgba(0,0,0,0.6)",
                  border: "none",
                  borderRadius: 999,
                  width: 22,
                  height: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <X size={13} color="#fff" />
              </button>
            </div>
          ))}
          {photos.length < 4 && (
            <button
              onClick={() => inputRef.current?.click()}
              style={{
                aspectRatio: "1",
                borderRadius: 10,
                border: `1.5px dashed ${MUTED}`,
                background: CARD,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                cursor: "pointer",
                color: MUTED,
              }}
            >
              <Camera size={20} />
              <span style={{ fontSize: 11 }}>Aufnehmen</span>
            </button>
          )}
          {photos.length < 4 && (
            <button
              onClick={() => uploadRef.current?.click()}
              style={{
                aspectRatio: "1",
                borderRadius: 10,
                border: `1.5px dashed ${MUTED}`,
                background: CARD,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                cursor: "pointer",
                color: MUTED,
              }}
            >
              <Upload size={20} />
              <span style={{ fontSize: 11 }}>Hochladen</span>
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Analyze button */}
        {status !== "done" && (
          <button
            onClick={analyze}
            disabled={photos.length === 0 || status === "analyzing"}
            style={{
              width: "100%",
              padding: "13px 0",
              borderRadius: 10,
              border: "none",
              background: photos.length === 0 ? "#3A382F" : ACCENT,
              color: photos.length === 0 ? MUTED : "#1C1B19",
              fontWeight: 700,
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              cursor: photos.length === 0 ? "default" : "pointer",
            }}
          >
            {status === "analyzing" ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Analysiere Fotos …
              </>
            ) : (
              <>
                <Camera size={18} /> Artikel erkennen
              </>
            )}
          </button>
        )}

        {errorMsg && (
          <div style={{ marginTop: 12, color: "#E08A6F", fontSize: 13, display: "flex", gap: 6 }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Results */}
        {result && (
          <div style={{ marginTop: 22 }}>
            {result.multi_item_detected && (
              <div
                style={{
                  background: CARD,
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 16,
                  border: `1px solid ${result.bundle_recommendation?.recommended ? TEAL : "#3A382F"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Layers size={16} color={TEAL} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {result.items.length} Artikel erkannt
                  </span>
                </div>
                <p style={{ fontSize: 13, color: TEXT, margin: "0 0 4px", lineHeight: 1.45 }}>
                  {result.bundle_recommendation?.reasoning}
                </p>
                <p style={{ fontSize: 13, fontWeight: 700, color: TEAL, margin: 0 }}>
                  {result.bundle_recommendation?.recommended
                    ? `Empfehlung: als Bundle für ca. CHF ${result.bundle_recommendation?.bundle_price_chf} verkaufen`
                    : "Empfehlung: einzeln verkaufen"}
                </p>
              </div>
            )}

            {result.items.map((item, idx) => (
              <div
                key={idx}
                style={{
                  background: CARD,
                  borderRadius: 14,
                  padding: 16,
                  marginBottom: 14,
                  position: "relative",
                }}
              >
                {/* Preisschild-Lochung */}
                <div
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: BG,
                    border: `1.5px solid ${MUTED}`,
                  }}
                />
                <p style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 4px" }}>
                  {item.category} · {item.condition_guess}
                </p>
                <h3 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, margin: "0 0 6px", paddingRight: 20 }}>
                  {item.suggested_title}
                </h3>
                <p style={{ fontSize: 13.5, color: TEXT, lineHeight: 1.5, margin: "0 0 12px" }}>
                  {item.suggested_description}
                </p>

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <div style={{ background: BG, borderRadius: 8, padding: "6px 10px" }}>
                    <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 700, color: ACCENT }}>
                      CHF {item.estimated_price_chf_min}–{item.estimated_price_chf_max}
                    </span>
                  </div>
                  <div
                    style={{
                      background: BG,
                      borderRadius: 8,
                      padding: "6px 10px",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <TrendingUp size={14} color={scoreColor(item.sell_score)} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(item.sell_score) }}>
                      Score {item.sell_score}/10
                    </span>
                  </div>
                  <div
                    style={{
                      background: BG,
                      borderRadius: 8,
                      padding: "6px 10px",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <Clock size={14} color={MUTED} />
                    <span style={{ fontSize: 13, color: TEXT }}>~{item.estimated_days_to_sell} Tage</span>
                  </div>
                </div>

                {item.missing_photo_suggestions?.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 11.5, color: MUTED, margin: "0 0 4px" }}>Noch fotografieren:</p>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: TEXT }}>
                      {item.missing_photo_suggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => saveDraft(item)}
                  style={{
                    width: "100%",
                    padding: "9px 0",
                    borderRadius: 8,
                    border: `1px solid ${MUTED}`,
                    background: "transparent",
                    color: TEXT,
                    fontSize: 13,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    cursor: "pointer",
                  }}
                >
                  <Check size={14} /> Als Entwurf speichern
                </button>
              </div>
            ))}

            {savedCount > 0 && (
              <p style={{ fontSize: 12, color: TEAL, textAlign: "center", marginTop: 4 }}>
                {savedCount} Entwurf/Entwürfe gespeichert
              </p>
            )}

            <button
              onClick={reset}
              style={{
                width: "100%",
                padding: "11px 0",
                borderRadius: 10,
                border: "none",
                background: "transparent",
                color: MUTED,
                fontSize: 13,
                marginTop: 10,
                cursor: "pointer",
              }}
            >
              Neue Fotos analysieren
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
