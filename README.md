# Docunym

Android-App zum Anonymisieren von fotografierten Dokumenten und Screenshots, **komplett offline**.

1. Dokument fotografieren oder Bild/Screenshot aus der Galerie wählen.
2. Die Texterkennung (Tesseract, deutsch) läuft auf dem Handy und markiert:
   - **Namen** (nach „Herr/Frau/Name:/Patient …“, bekannte Vor- und Nachnamen),
   - **Adressen** (Straßen mit Hausnummer, Ort nach Postleitzahl),
   - **Zahlen** (alles mit Ziffern: Datum, IBAN, Telefon, Kundennummer, Beträge …),
   - **Kontakt** (E-Mail, Webadressen).
3. Prüfen: Treffer antippen schaltet sie an/aus, ein nicht erkanntes Wort antippen markiert es,
   mit dem Finger einen Rahmen ziehen deckt einen beliebigen Bereich ab (z. B. Unterschrift, Foto).
   „Gesamten Text“ markiert alles Erkannte.
4. Pro Bild wählbar: **Schwärzen** (schwarze Balken) oder **Ersetzen** (Dummy-Namen, -Adressen und -Zahlen
   in Papier- und Schriftfarbe; Datumsangaben bleiben gültige Daten).
5. **Speichern** legt ein neues JPEG unter `Bilder/Anonymisiert` ab, **Teilen** öffnet das Android-Teilen-Menü.

## Datenschutz

- Die APK hat **keine Internet-Berechtigung**. Der Build schlägt fehl, falls sie jemals hineinkommt
  (`.github/workflows/android.yml`). Zusätzlich verbietet eine Content-Security-Policy jede externe Verbindung.
- Texterkennung, Sprachdaten und Engine sind in der App enthalten (`scripts/copy-ocr.mjs`).
- Das gespeicherte Bild wird neu aus den Pixeln erzeugt: **keine EXIF-Daten** (kein Ort, keine Aufnahmezeit, kein
  Gerät), zufälliger Dateiname ohne Datum. Das Kamerafoto wird nicht in der Galerie gespeichert und die
  temporäre Kameradatei wird gelöscht. Originale aus der Galerie bleiben unverändert – die bitte selbst löschen.
- Im Modus **Schwärzen** ist der Originaltext unter den Balken nicht mehr vorhanden (keine Ebenen, nur Pixel).

### Grenzen

Die Erkennung ist eine Heuristik. Handschrift, Unterschriften, Logos, Stempel, Fotos von Personen und
seltene Namen ohne Anrede werden **nicht** automatisch gefunden – vor dem Speichern immer in der Vorschau
prüfen und fehlende Stellen von Hand abdecken.

## Entwicklung

```
npm ci
npm run dev        # Browser-Version (Datei-Auswahl statt Kamera)
npx tsc --noEmit && npx vitest run && npm run build
```

Die APK baut GitHub Actions bei jedem Push; auf `main` wird sie als Release `latest` veröffentlicht.
