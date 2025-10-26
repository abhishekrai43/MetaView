Project: MetaView — Image-first PWA (minimal, production-ready)
Goal: Create a small PWA that reads EXIF from a photo, overlays key metadata on the image (timestamp, approximate place if GPS exists, device model), and exports a baked image (download / Web Share). Client-only, offline-first, no backend. Keep it small and pragmatic — no tests.

Requirements & constraints:
- Framework: Vanilla JS (ES modules) + tiny CSS. Do NOT use large frameworks.
- Dependencies: use CDN libs only:
  - exifr (for EXIF/GPS parsing)
  - localforage (for simple IndexedDB storage) — optional but preferred
- PWA: include manifest.json and a service worker that caches the app shell and enables offline loading.
- UI: single-page app with 3 primary views: Home (Take / Import), Preview (overlay + controls), History (optional).
- Features (MVP):
  1. Import or capture image:
     - "Take Photo" button using `<input type="file" accept="image/*;capture=camera">`
     - "Import Photo" button using file input or drag-drop
  2. Read EXIF: use exifr to extract DateTimeOriginal (or file timestamp), GPS coords, and Model (device).
  3. Reverse-geocode GPS to human-readable city/country only if user opts in — otherwise show lat/lon. (Optional: use a free reverse geocoding service, but code must be toggleable; do not require API keys.)
  4. Overlay: render image on `<canvas>` and draw a readable overlay (timestamp · place · device) with style controls (position: bottom-left/bottom-right, opacity slider, choose small font size).
  5. Export: Bake overlay to a new image and allow:
     - Download (`canvas.toBlob()` -> createObjectURL -> download)
     - Web Share API (if supported)
  6. Preserve privacy: explicitly state in UI that everything is local and nothing is uploaded unless user chooses reverse-geocode (if network used).
  7. Save last N baked images metadata in IndexedDB via localforage for quick re-download (history list).
  8. Detect if image already contains a baked MetaView overlay (simple heuristic: look for a small custom marker in EXIF UserComment or filename suffix). If detected, show a notice and offer "view original" (if original available).
- File outputs: produce these files at minimum:
  - index.html
  - styles.css
  - app.js (ES module)
  - manifest.json
  - sw.js (service worker)
  - icons (placeholder)
- Keep all code concise (< 600 lines total). No unit tests. No server. No build step required.
- Make UX mobile-first and accessible (large tappable buttons, readable font sizes).
- Add helpful small copy: "Nothing leaves your device unless you opt-in to reverse-geocode" and "Tap Export to save a baked image."
- Use progressive enhancement: if Web Share API not available, fall back to download.

Deliverable: Generate the complete contents of each file listed above. Make sure the HTML references the CDN script URLs for exifr and localforage. Keep comments minimal but include short inline comments for important steps (EXIF read, draw overlay, export). Provide a short README snippet at top of index.html describing how to run locally (open index.html via static server or use `npx http-server`).

Important: keep implementation compact and production-minded (error handling for missing EXIF, large images scaled down for canvas to avoid memory issues, permission prompts handled gracefully). Do not include tests or unnecessary features.

End.
