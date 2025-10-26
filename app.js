import exifr from 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs';

let localStore;
try {
  const { default: localforage } = await import('https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.mjs');
  localStore = localforage;
} catch (err) {
  console.warn('localforage not available, settings will not persist across reloads', err);
  const memory = new Map();
  localStore = {
    async getItem(key) {
      return memory.get(key) ?? null;
    },
    async setItem(key, value) {
      memory.set(key, value);
      return value;
    }
  };
}

// History removed per request
const SETTINGS_KEY = 'metaview-settings';
const MAX_CANVAS_EDGE = 2400;
const OVERLAY_MARKER = 'MetaViewOverlay';
const GEO_PROMPT_DEFAULT = 'This photo lacks GPS metadata. Allow device location to tag the place.';

const state = {
  file: null,
  originalURL: null,
  bitmap: null,
  meta: {},
  captureMode: 'import', // 'capture' | 'import'
  overlayText: '',
  locationText: '',
  manualCoords: null,
  locationSource: 'none',
  reverseEnabled: false,
  position: 'bottom-left',
  fontSize: 20,
  opacity: 0.65,
  // Import mode share options
  shareTimestamp: true,
  shareLocation: true,
  shareDevice: true,
  shareOwnerOnly: false,
  // Capture mode metadata overlay options
  captureShowOwner: true,
  captureShowDate: true,
  captureShowDevice: true,
  captureShowLocation: true,
  // Watermark & verify hint
  prominentWatermark: false,
  
  // history removed
  // Settings
  userDeviceLabel: '',
  userContact: '', // user's contact info (name, email, phone, whatever they want)
  // signature fields removed for MVP
  
};

const els = {
  views: {
    home: document.getElementById('homeView'),
    preview: document.getElementById('previewView'),
    importMode: document.getElementById('importModeView'),
    captureMode: document.getElementById('captureModeView')
  },
  navButtons: document.querySelectorAll('[data-nav]'),
  takeBtn: document.getElementById('takeBtn'),
  importBtn: document.getElementById('importBtn'),
  takeInput: document.getElementById('takeInput'),
  fileInput: document.getElementById('fileInput'),
  dropZone: document.getElementById('dropZone'),
  canvas: document.getElementById('previewCanvas'),
  metadataDisplay: document.getElementById('metadataDisplay'),
  metadataContent: document.getElementById('metadataContent'),
  noImageNotice: document.getElementById('noImageNotice'),
  noExifNotice: document.getElementById('noExifNotice'),
  insecureContextNotice: document.getElementById('insecureContextNotice'),
  geoPrompt: document.getElementById('geoPrompt'),
  geoPromptMsg: document.getElementById('geoPromptMsg'),
  geoRequestBtn: document.getElementById('geoRequestBtn'),
  overlayWarning: document.getElementById('overlayWarning'),
  viewOriginalBtn: document.getElementById('viewOriginalBtn'),
  positionSelect: document.getElementById('positionSelect'),
  fontSlider: document.getElementById('fontSlider'),
  opacitySlider: document.getElementById('opacitySlider'),
  reverseToggle: document.getElementById('reverseToggle'),
  deviceLabelInput: document.getElementById('deviceLabelInput'),
  ownerInput: document.getElementById('ownerInput'),
  prominentWatermarkToggle: document.getElementById('prominentWatermark'),
  
  copyCaptionBtn: document.getElementById('copyCaptionBtn'),
  modelResolveSpinner: document.getElementById('modelResolveSpinner'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingMessage: document.getElementById('loadingMessage'),
  shareBtn: document.getElementById('shareBtn'),
  shareImportBtn: document.getElementById('shareImportBtn'),
  shareTimestampToggle: document.getElementById('shareTimestamp'),
  shareLocationToggle: document.getElementById('shareLocation'),
  shareDeviceToggle: document.getElementById('shareDevice'),
  shareOwnerOnlyToggle: document.getElementById('shareOwnerOnly'),
  backBtn: document.getElementById('backBtn'),
  backBtn2: document.getElementById('backBtn2'),
  previewMeta: document.getElementById('previewMeta'),
  // Capture mode metadata selection toggles
  captureShowOwnerToggle: document.getElementById('captureShowOwner'),
  captureShowDateToggle: document.getElementById('captureShowDate'),
  captureShowDeviceToggle: document.getElementById('captureShowDevice'),
  captureShowLocationToggle: document.getElementById('captureShowLocation')
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  });
}

// Check for secure context and show warning if needed
if (!window.isSecureContext) {
  setInsecureContextVisible(true);
}

if (!('share' in navigator)) {
  els.shareBtn.hidden = true;
}

els.navButtons.forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.nav));
});

// Try to enrich device descriptor using User-Agent Client Hints (UA-CH) on supported browsers.
void updateDeviceDescriptor();

function setSpinner(el, show) {
  if (!el) return;
  el.hidden = !show;
}

function setInsecureContextVisible(show) {
  if (els.insecureContextNotice) {
    els.insecureContextNotice.hidden = !show;
  }
}

function showLoading(message = 'Processing image…') {
  if (!els.loadingOverlay || !els.loadingMessage) return;
  els.loadingMessage.textContent = message;
  els.loadingOverlay.hidden = false;
}

function hideLoading() {
  if (!els.loadingOverlay) return;
  els.loadingOverlay.hidden = true;
}

els.takeBtn.addEventListener('click', () => { 
  state.captureMode = 'capture'; 
  els.takeInput.click(); 
});
els.importBtn.addEventListener('click', () => { 
  state.captureMode = 'import'; 
  els.fileInput.click(); 
});
els.takeInput.addEventListener('change', evt => { 
  state.captureMode = 'capture'; 
  onFilePicked(evt.target.files); 
});
els.fileInput.addEventListener('change', evt => { 
  state.captureMode = 'import'; 
  onFilePicked(evt.target.files); 
});
els.dropZone.addEventListener('click', () => { state.captureMode = 'import'; els.fileInput.click(); });
els.dropZone.addEventListener('keydown', evt => {
  if (evt.key === 'Enter' || evt.key === ' ') {
    evt.preventDefault();
    state.captureMode = 'import';
    els.fileInput.click();
  }
});
els.dropZone.addEventListener('dragover', evt => {
  evt.preventDefault();
  els.dropZone.classList.add('dragover');
});
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', evt => {
  evt.preventDefault();
  els.dropZone.classList.remove('dragover');
  state.captureMode = 'import';
  onFilePicked(evt.dataTransfer.files);
});

els.positionSelect.addEventListener('change', evt => {
  state.position = evt.target.value;
  drawPreview();
});
els.fontSlider.addEventListener('input', evt => {
  state.fontSize = Number(evt.target.value);
  drawPreview();
});
els.opacitySlider.addEventListener('input', evt => {
  state.opacity = Number(evt.target.value);
  drawPreview();
});
els.reverseToggle.addEventListener('change', async evt => {
  state.reverseEnabled = evt.target.checked;
  await resolveLocation();
  updateOverlayText();
  drawPreview();
  updateMetaPanel();
});
els.deviceLabelInput?.addEventListener('input', async evt => {
  state.userDeviceLabel = (evt.target.value || '').trim();
  await saveSettings();
  updateOverlayText();
});
els.ownerInput?.addEventListener('input', async evt => {
  state.userContact = (evt.target.value || '').trim();
  await saveSettings();
  updateOverlayText();
});
els.prominentWatermarkToggle?.addEventListener('change', evt => {
  state.prominentWatermark = !!evt.target.checked;
  drawPreview();
});
els.copyCaptionBtn?.addEventListener('click', async () => {
  const caption = generateCaption();
  try {
    await navigator.clipboard.writeText(caption);
    alert('Caption copied to clipboard');
  } catch (e) {
    alert('Failed to copy caption');
  }
});

// Import mode share option toggles
els.shareOwnerOnlyToggle?.addEventListener('change', evt => {
  const ownerOnly = evt.target.checked;
  state.shareOwnerOnly = ownerOnly;
  if (ownerOnly) {
    // When owner-only is checked, disable other options
    state.shareLocation = false;
    state.shareDevice = false;
    if (els.shareLocationToggle) els.shareLocationToggle.checked = false;
    if (els.shareDeviceToggle) els.shareDeviceToggle.checked = false;
  }
});
els.shareTimestampToggle?.addEventListener('change', evt => {
  state.shareTimestamp = evt.target.checked;
});
els.shareLocationToggle?.addEventListener('change', evt => {
  state.shareLocation = evt.target.checked;
  if (evt.target.checked && state.shareOwnerOnly) {
    state.shareOwnerOnly = false;
    if (els.shareOwnerOnlyToggle) els.shareOwnerOnlyToggle.checked = false;
  }
});
els.shareDeviceToggle?.addEventListener('change', evt => {
  state.shareDevice = evt.target.checked;
  if (evt.target.checked && state.shareOwnerOnly) {
    state.shareOwnerOnly = false;
    if (els.shareOwnerOnlyToggle) els.shareOwnerOnlyToggle.checked = false;
  }
});

// Capture mode metadata selection toggles
els.captureShowOwnerToggle?.addEventListener('change', evt => {
  state.captureShowOwner = evt.target.checked;
  updateOverlayText();
  drawPreview();
});
els.captureShowDateToggle?.addEventListener('change', evt => {
  state.captureShowDate = evt.target.checked;
  updateOverlayText();
  drawPreview();
});
els.captureShowDeviceToggle?.addEventListener('change', evt => {
  state.captureShowDevice = evt.target.checked;
  updateOverlayText();
  drawPreview();
});
els.captureShowLocationToggle?.addEventListener('change', evt => {
  state.captureShowLocation = evt.target.checked;
  updateOverlayText();
  drawPreview();
});

els.shareBtn.addEventListener('click', () => shareImage());
els.shareImportBtn?.addEventListener('click', () => shareImportedImage());
els.backBtn.addEventListener('click', () => navigate('home'));
if (els.backBtn2) els.backBtn2.addEventListener('click', () => navigate('home'));
els.viewOriginalBtn.addEventListener('click', () => {
  if (state.originalURL) {
    window.open(state.originalURL, '_blank');
  }
});
if (els.geoRequestBtn) {
  els.geoRequestBtn.addEventListener('click', () => requestCurrentLocation());
}

// Load settings, then proactively request device location (for metadata) if available.
(async () => {
  await loadSettings();
  try {
    // Only request location prompt on secure contexts and when geolocation is supported.
    if ('geolocation' in navigator && window.isSecureContext) {
      // Show the geo prompt UI and trigger a request to obtain device coords for metadata.
      setGeoPromptMessage('This app requests location access to improve photo metadata. Tap Allow when prompted.');
      setGeoPromptVisible(true);
      // Kick off the location request but don't block startup on it. requestCurrentLocation
      // will handle retries and messages internally.
      requestCurrentLocation().catch(err => {
        console.warn('Initial location request failed or was denied', err);
      });
    }
  } catch (err) {
    console.warn('Error during startup location request', err);
  }
})();

function navigate(view) {
  Object.entries(els.views).forEach(([key, node]) => {
    if (!node) return;
    const isActive = key === view;
    node.classList.toggle('active', isActive);
    node.hidden = !isActive;
  });
  
  // Show/hide mode-specific views in preview
  if (view === 'preview') {
    if (state.captureMode === 'import') {
      if (els.views.importMode) {
        els.views.importMode.hidden = false;
      }
      if (els.views.captureMode) {
        els.views.captureMode.hidden = true;
      }
    } else {
      if (els.views.importMode) {
        els.views.importMode.hidden = true;
      }
      if (els.views.captureMode) {
        els.views.captureMode.hidden = false;
      }
    }
  }
}

async function onFilePicked(fileList) {
  const file = fileList && fileList[0];
  if (!file) {
    return;
  }
  if (!file.type.startsWith('image/')) {
    alert('Please choose an image file.');
    return;
  }
  els.takeInput.value = '';
  els.fileInput.value = '';
  try {
    await loadImage(file);
    navigate('preview');
  } catch (err) {
    alert('Failed to load image: ' + err.message);
  }
}

async function loadImage(file) {
  showLoading('Processing image…');
  try {
    cleanupCurrentImage();
    state.file = file;
    state.originalURL = URL.createObjectURL(file);
    
    const meta = await readMetadata(file);
    
    state.meta = meta;
    
    // Store whether this photo had original EXIF metadata
    const hadOriginalModel = !!(meta.Model);
    const hadOriginalDate = !!(meta.DateTimeOriginal || meta.CreateDate);
    
    applyFallbackMetadata(meta, file);
    
    // Only update device descriptor if no original EXIF Model was present
    if (!hadOriginalModel) {
      await updateDeviceDescriptor();
    }
    
    showNoExifNoticeIfNeeded(meta, file.name);
    state.reverseEnabled = true;
    els.reverseToggle.checked = true;
    
    const metaCoords = getCoordsFromMeta(meta);
    
    // Location request logic:
    // - IMPORT mode: Never request location, use EXIF GPS only
    // - CAPTURE mode: Request location if no GPS in photo
    if (state.captureMode === 'capture') {
      if (!metaCoords && 'geolocation' in navigator && window.isSecureContext) {
        setGeoPromptMessage('Tag this captured photo with your current location. Tap Allow when prompted.');
        setGeoPromptVisible(true);
        await requestCurrentLocation();
      } else {
        setGeoPromptVisible(false);
      }
    } else {
      // Import mode: never request location
      setGeoPromptVisible(false);
    }
  
  // Use device coords if available, else fallback to EXIF
  if (!metaCoords && state.manualCoords) {
    state.locationSource = 'device';
  } else if (metaCoords) {
    state.locationSource = 'exif';
  } else {
    state.locationSource = 'none';
  }
  
  const coords = getActiveCoords();
  state.locationText = coords ? formatCoords(coords.lat, coords.lon) : 'No GPS metadata';
  
  updateOverlayText();
  await resolveLocation();
  updateOverlayText();
  await rasterizeImage(file, meta.Orientation);
  detectOverlay(meta, file.name);
  
  // Show appropriate UI based on mode
  if (state.captureMode === 'import') {
    displayMetadataViewer();
  } else {
    updateMetaPanel();
    enableExport(true);
  }
  
  drawPreview();
  } finally {
    hideLoading();
  }
}

function showNoExifNoticeIfNeeded(meta, fileName) {
  const hasDate = !!(meta?.DateTimeOriginal || meta?.CreateDate);
  const hasGPS = !!(meta?.GPSLatitude && meta?.GPSLongitude);
  const hasModel = !!meta?.Model;
  const likelyMessaging = /(?:^|\b)(IMG|VID)-\d{8}-WA\d+|WhatsApp|Telegram|photo_\d+/i.test(fileName || '');
  const presentCount = [hasDate, hasGPS, hasModel].filter(Boolean).length;
  const show = presentCount <= 1 || likelyMessaging;
  if (els.noExifNotice) {
    els.noExifNotice.hidden = !show;
  }
}

function cleanupCurrentImage() {
  if (state.originalURL) {
    URL.revokeObjectURL(state.originalURL);
  }
  state.bitmap = null;
  const ctx = els.canvas.getContext('2d');
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  els.noImageNotice.hidden = true;
  els.overlayWarning.hidden = true;
  enableExport(false);
}

// Read EXIF metadata (timestamp, GPS, device, orientation) if available.
async function readMetadata(file) {
  try {
    // iOS Safari workaround: convert to blob if needed
    let fileToRead = file;
    if (file.size === 0 || !file.type) {
      const blob = await file.arrayBuffer().then(ab => new Blob([ab], { type: 'image/jpeg' }));
      fileToRead = new File([blob], file.name || 'image.jpg', { type: 'image/jpeg' });
    }
    
    // Try full parse first to see all available data
    const fullMeta = await exifr.parse(fileToRead, { 
      tiff: true, 
      xmp: false, 
      icc: false, 
      iptc: false,
      jfif: false
    });
    
    // Extract the fields we need
    const meta = {
      DateTimeOriginal: fullMeta?.DateTimeOriginal,
      CreateDate: fullMeta?.CreateDate,
      Model: fullMeta?.Model,
      Make: fullMeta?.Make,
      UserComment: fullMeta?.UserComment,
      GPSLatitude: fullMeta?.latitude || fullMeta?.GPSLatitude,
      GPSLongitude: fullMeta?.longitude || fullMeta?.GPSLongitude,
      GPSLatitudeRef: fullMeta?.GPSLatitudeRef,
      GPSLongitudeRef: fullMeta?.GPSLongitudeRef,
      Orientation: fullMeta?.Orientation || 1
    };
    
    return meta;
  } catch (err) {
    return {};
  }
}

function applyFallbackMetadata(meta, file) {
  if (!meta) return;
  
  // Only set current timestamp if missing AND in capture mode
  if (!meta.DateTimeOriginal && !meta.CreateDate) {
    if (state.captureMode === 'capture') {
      // For captures, use current time
      meta.DateTimeOriginal = new Date();
    } else if (file?.lastModified) {
      // For imports, use file's last modified time
      meta.DateTimeOriginal = new Date(file.lastModified);
    } else {
      meta.DateTimeOriginal = new Date();
    }
  }
  
  // Only set device descriptor if missing AND in capture mode
  if (!meta.Model && state.captureMode === 'capture') {
    meta.Model = getDeviceDescriptor();
  }
}

async function updateDeviceDescriptor() {
  try {
    setSpinner(els.modelResolveSpinner, true);
    const nav = navigator;
    if (nav.userAgentData?.getHighEntropyValues) {
      const info = await nav.userAgentData.getHighEntropyValues(['model','platform','fullVersionList']);
      const model = info.model; // e.g., "Pixel 7" on Android
      const platform = info.platform; // e.g., "Android"
      const friendly = resolveFriendlyModel(model);
      const descriptor = friendly || [model, platform].filter(Boolean).join(' ');
      if (descriptor) {
        // If meta.Model is generic, prefer descriptor
        if (!state.meta.Model || /Unknown device|Windows|Mac|Linux|Android/i.test(state.meta.Model)) {
          state.meta.Model = descriptor;
          if (els.deviceLabelInput && !state.userDeviceLabel && !els.deviceLabelInput.value) {
            els.deviceLabelInput.placeholder = descriptor;
          }
          // Only update overlay if an image is loaded
          if (state.bitmap) {
            updateOverlayText();
            updateMetaPanel();
          }
        }
      }
    }
  } catch (err) {
    console.warn('[MetaView] UA-CH device model not available:', err);
  } finally {
    setSpinner(els.modelResolveSpinner, false);
  }
}

function getCoordsFromMeta(meta) {
  const lat = toDecimal(meta?.GPSLatitude, meta?.GPSLatitudeRef);
  const lon = toDecimal(meta?.GPSLongitude, meta?.GPSLongitudeRef);
  if (lat == null || lon == null) return null;
  return { lat, lon };
}

function getActiveCoords() {
  if (state.manualCoords) return state.manualCoords;
  return getCoordsFromMeta(state.meta);
}

function toDecimal(value, ref) {
  if (typeof value === 'number') {
    return ref === 'S' || ref === 'W' ? -value : value;
  }
  if (!value) return null;
  // exifr may give array of [deg, min, sec]
  const [deg, min = 0, sec = 0] = Array.isArray(value) ? value : [value];
  const dec = deg + min / 60 + sec / 3600;
  if (!ref) return dec;
  return ref === 'S' || ref === 'W' ? -dec : dec;
}

function formatCoords(lat, lon) {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

// Optionally call reverse geocoding (Nominatim) when user opts in.
async function resolveLocation() {
  const coords = getActiveCoords();
  if (!coords) {
    state.locationText = 'No GPS metadata';
    state.locationSource = 'none';
    updateMetaPanel();
    return;
  }
  state.locationSource = state.manualCoords ? 'device' : 'exif';
  if (!state.reverseEnabled) {
    state.locationText = formatCoords(coords.lat, coords.lon);
    updateMetaPanel();
    return;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lon}&zoom=10`;
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'en'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`Reverse geocode failed: ${resp.status}`);
    const data = await resp.json();
    const city = data.address?.city || data.address?.town || data.address?.village || data.address?.state;
    const country = data.address?.country;
    state.locationText = [city, country].filter(Boolean).join(', ') || formatCoords(coords.lat, coords.lon);
  } catch (err) {
    console.error('[MetaView] Reverse geocode error:', err);
    state.locationText = `${formatCoords(coords.lat, coords.lon)} (network unavailable)`;
  } finally {
    // no spinner per request
  }
  updateMetaPanel();
}

function setGeoPromptVisible(show) {
  if (!els.geoPrompt) return;
  els.geoPrompt.hidden = !show;
  if (show && els.geoRequestBtn) {
    els.geoRequestBtn.disabled = false;
  }
}

function setGeoPromptMessage(message) {
  if (els.geoPromptMsg && typeof message === 'string') {
    els.geoPromptMsg.textContent = message;
  }
}

async function requestCurrentLocation() {
  if (!('geolocation' in navigator)) {
    setGeoPromptMessage('Device location not supported in this browser.');
    return;
  }
  if (!window.isSecureContext) {
    setGeoPromptVisible(true);
    setGeoPromptMessage('Browser blocks location on HTTP. Open this app over HTTPS to allow location.');
    return;
  }
  setGeoPromptVisible(true);
  setGeoPromptMessage('Requesting location… (respond to the browser prompt)');
  if (els.geoRequestBtn) {
    els.geoRequestBtn.disabled = true;
  }
  try {
    const position = await getCurrentPosition();
    state.manualCoords = {
      lat: position.coords.latitude,
      lon: position.coords.longitude
    };
    state.locationSource = 'device';
    setGeoPromptMessage('Location acquired!');
    setTimeout(() => setGeoPromptVisible(false), 1500);
    await resolveLocation();
    updateOverlayText();
    drawPreview();
  } catch (err) {
    console.warn('Geolocation error', err);
    let msg = 'Unable to fetch current location. Try again later.';
    if (err && typeof err === 'object' && 'code' in err) {
      switch (err.code) {
        case err.PERMISSION_DENIED:
          msg = 'Permission denied. Enable location access in browser settings and reload.';
          // Remember denial to avoid re-prompting repeatedly
          state.locationPermissionDenied = true;
          break;
        case err.POSITION_UNAVAILABLE:
          msg = 'Location unavailable. Move outside or check connectivity.';
          break;
        default:
          break;
      }
    }
    setGeoPromptVisible(true);
    setGeoPromptMessage(msg);
    if (els.geoRequestBtn) {
      els.geoRequestBtn.disabled = false;
    }
  } finally {
    // no spinner per request
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    // Use browser defaults for timeout; remove artificial short timeout to avoid spurious TIMEOUT errors
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true
    });
  });
}

function getDeviceDescriptor() {
  try {
    const nav = navigator;
    if (nav.userAgentData) {
      const brands = nav.userAgentData.brands
        ?.filter(b => b.brand && b.brand !== 'Not:A-Brand')
        .map(b => b.brand)
        .join(' ');
      const platform = nav.userAgentData.platform;
      const descriptor = [brands, platform].filter(Boolean).join(' ');
      if (descriptor) {
        return descriptor;
      }
    }
    if (nav.platform) {
      return nav.platform;
    }
    const fallback = nav.userAgent || 'Unknown device';
    return fallback;
  } catch (err) {
    console.error('[MetaView] Device descriptor lookup failed:', err);
    return 'Unknown device';
  }
}

function getFriendlyModelFromUA() {
  try {
    const ua = navigator.userAgent || '';
    const m = ua.match(/Build\/(\w[\w-]+)/i);
    const code = m?.[1];
    if (!code) return null;
    // Basic vendor heuristics
    const mapped = resolveFriendlyModel(code);
    if (mapped) return mapped;
    if (/^SM-/.test(code)) return `Samsung ${code}`;
    if (/^CPH/.test(code)) return `OPPO/OnePlus ${code}`;
    if (/^RMX/.test(code)) return `realme ${code}`;
    if (/^M\d/.test(code) || /Mi|Redmi|MIX/i.test(ua)) return `Xiaomi/Redmi ${code}`;
    return code;
  } catch {
    return null;
  }
}

// Map common device codes and names to friendly marketing names
function resolveFriendlyModel(codeOrName) {
  if (!codeOrName) return null;
  const s = String(codeOrName).trim();
  
  // Comprehensive phone model database covering all major brands
  const table = {
    // Apple iPhone (EXIF Model field)
    'iPhone': 'Apple iPhone',
    'iPhone SE': 'Apple iPhone SE',
    'iPhone SE (2nd generation)': 'Apple iPhone SE (2nd gen)',
    'iPhone SE (3rd generation)': 'Apple iPhone SE (3rd gen)',
    'iPhone 11': 'Apple iPhone 11',
    'iPhone 11 Pro': 'Apple iPhone 11 Pro',
    'iPhone 11 Pro Max': 'Apple iPhone 11 Pro Max',
    'iPhone 12': 'Apple iPhone 12',
    'iPhone 12 mini': 'Apple iPhone 12 mini',
    'iPhone 12 Pro': 'Apple iPhone 12 Pro',
    'iPhone 12 Pro Max': 'Apple iPhone 12 Pro Max',
    'iPhone 13': 'Apple iPhone 13',
    'iPhone 13 mini': 'Apple iPhone 13 mini',
    'iPhone 13 Pro': 'Apple iPhone 13 Pro',
    'iPhone 13 Pro Max': 'Apple iPhone 13 Pro Max',
    'iPhone 14': 'Apple iPhone 14',
    'iPhone 14 Plus': 'Apple iPhone 14 Plus',
    'iPhone 14 Pro': 'Apple iPhone 14 Pro',
    'iPhone 14 Pro Max': 'Apple iPhone 14 Pro Max',
    'iPhone 15': 'Apple iPhone 15',
    'iPhone 15 Plus': 'Apple iPhone 15 Plus',
    'iPhone 15 Pro': 'Apple iPhone 15 Pro',
    'iPhone 15 Pro Max': 'Apple iPhone 15 Pro Max',
    'iPhone 16': 'Apple iPhone 16',
    'iPhone 16 Plus': 'Apple iPhone 16 Plus',
    'iPhone 16 Pro': 'Apple iPhone 16 Pro',
    'iPhone 16 Pro Max': 'Apple iPhone 16 Pro Max',
    
    // OnePlus / OPPO
    'CPH2467': 'OnePlus Nord CE 3 Lite 5G',
    'CPH2465': 'OnePlus Nord CE 3 Lite 5G',
    'CPH2451': 'OnePlus 11',
    'CPH2449': 'OnePlus 11R',
    'CPH2413': 'OnePlus 10 Pro',
    'CPH2399': 'OnePlus 10T',
    'CPH2417': 'OnePlus 10R',
    'CPH2301': 'OnePlus Nord 2T',
    'CPH2363': 'OnePlus Nord CE 2',
    'CPH2581': 'OnePlus 12',
    'CPH2583': 'OnePlus 12R',
    'CPH2609': 'OnePlus Nord 4',
    'LE2117': 'OnePlus 9 Pro',
    'LE2115': 'OnePlus 9',
    'LE2121': 'OnePlus 9RT',
    
    // realme
    'RMX3687': 'realme 11 Pro+ 5G',
    'RMX3771': 'realme Narzo 70 Pro 5G',
    'RMX3630': 'realme 10 Pro+',
    'RMX3661': 'realme 11 Pro 5G',
    'RMX3310': 'realme GT 2 Pro',
    'RMX3031': 'realme GT Master Edition',
    'RMX3393': 'realme GT Neo 3',
    'RMX3561': 'realme 10',
    'RMX3890': 'realme 12 Pro+',
    
    // Samsung Galaxy S series
    'SM-S911': 'Samsung Galaxy S23',
    'SM-S916': 'Samsung Galaxy S23+',
    'SM-S918': 'Samsung Galaxy S23 Ultra',
    'SM-S921': 'Samsung Galaxy S24',
    'SM-S926': 'Samsung Galaxy S24+',
    'SM-S928': 'Samsung Galaxy S24 Ultra',
    'SM-G991': 'Samsung Galaxy S21',
    'SM-G996': 'Samsung Galaxy S21+',
    'SM-G998': 'Samsung Galaxy S21 Ultra',
    'SM-G781': 'Samsung Galaxy S20 FE',
    
    // Samsung Galaxy A series
    'SM-A525': 'Samsung Galaxy A52',
    'SM-A536': 'Samsung Galaxy A53',
    'SM-A546': 'Samsung Galaxy A54',
    'SM-A556': 'Samsung Galaxy A55',
    'SM-A146': 'Samsung Galaxy A14',
    'SM-A326': 'Samsung Galaxy A32',
    
    // Samsung Galaxy Note / Z series
    'SM-N981': 'Samsung Galaxy Note 20',
    'SM-N986': 'Samsung Galaxy Note 20 Ultra',
    'SM-F946': 'Samsung Galaxy Z Fold4',
    'SM-F956': 'Samsung Galaxy Z Fold5',
    'SM-F721': 'Samsung Galaxy Z Flip4',
    'SM-F731': 'Samsung Galaxy Z Flip5',
    
    // Xiaomi / Redmi / POCO
    'M2101K6G': 'Xiaomi Mi 11',
    'M2102J20SG': 'Xiaomi 11T Pro',
    '2201123G': 'Xiaomi 12',
    '2211133G': 'Xiaomi 13',
    '23078PND5G': 'Xiaomi 13T Pro',
    '2407FPN8EG': 'Xiaomi 14T',
    'M2007J20CG': 'Redmi Note 9 Pro',
    '21061119DG': 'Redmi Note 10 Pro',
    '2201117TG': 'Redmi Note 11 Pro',
    '23021RAAEG': 'Redmi Note 12 Pro',
    '23090RA98G': 'Redmi Note 13 Pro',
    'M2004J19C': 'POCO X3',
    '2201116PG': 'POCO F4',
    '23013PC75G': 'POCO X5 Pro',
    
    // Google Pixel
    'Pixel 6': 'Google Pixel 6',
    'Pixel 6 Pro': 'Google Pixel 6 Pro',
    'Pixel 6a': 'Google Pixel 6a',
    'Pixel 7': 'Google Pixel 7',
    'Pixel 7 Pro': 'Google Pixel 7 Pro',
    'Pixel 7a': 'Google Pixel 7a',
    'Pixel 8': 'Google Pixel 8',
    'Pixel 8 Pro': 'Google Pixel 8 Pro',
    'Pixel 8a': 'Google Pixel 8a',
    'Pixel 9': 'Google Pixel 9',
    'Pixel 9 Pro': 'Google Pixel 9 Pro',
    'Pixel 9 Pro XL': 'Google Pixel 9 Pro XL',
    
    // Vivo
    'V2250': 'Vivo V27 Pro',
    'V2241': 'Vivo V29',
    'V2227': 'Vivo V25 Pro',
    'V2231': 'Vivo T2 Pro',
    
    // OPPO
    'CPH2269': 'OPPO Reno7 Pro',
    'CPH2343': 'OPPO Reno8 Pro',
    'CPH2481': 'OPPO Reno10 Pro',
    'CPH2531': 'OPPO Find N3',
    
    // Motorola
    'XT2241': 'Motorola Edge 30 Pro',
    'XT2301': 'Motorola Edge 40 Pro',
    'XT2321': 'Motorola Razr 40 Ultra',
    
    // Nothing
    'A063': 'Nothing Phone (1)',
    'A065': 'Nothing Phone (2)',
    'A142': 'Nothing Phone (2a)'
  };
  
  if (table[s]) return table[s];
  
  // If already a human name (contains spaces and vendor), prefer it
  if (/Apple|iPhone|OnePlus|Samsung|realme|Xiaomi|Redmi|Pixel|Vivo|OPPO|Motorola|Nothing/i.test(s) && /\s/.test(s)) return s;
  
  return null;
}

// Signature generation removed for MVP — function intentionally deleted

function updateOverlayText() {
  const timestamp = deriveTimestamp(state.meta) ?? 'Unknown time';
  const friendly = resolveFriendlyModel(state.meta.Model) || getFriendlyModelFromUA() || state.meta.Model;
  const device = (state.userDeviceLabel && state.userDeviceLabel.trim()) || friendly || 'Unknown device';
  const location = state.locationText || 'No GPS metadata';
  
  // Build overlay based on user selections
  const parts = [];
  
  if (state.captureShowDate) {
    parts.push(timestamp);
  }
  
  if (state.captureShowLocation) {
    parts.push(location);
  }
  
  if (state.captureShowDevice) {
    parts.push(device);
  }
  
  let text = parts.join('\n');
  // Add owner/contact line if requested
  if (state.captureShowOwner && state.userContact) {
    if (text) text += '\n';
    text += state.userContact;
  }
  state.overlayText = text;
  if (state.bitmap) {
    drawPreview();
  }
}

function deriveTimestamp(meta) {
  const value = meta.DateTimeOriginal || meta.CreateDate;
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value.replace(/:/, '-')); // basic fallback
    if (!isNaN(parsed)) return parsed.toLocaleString();
    return value;
  }
  return null;
}

async function rasterizeImage(file, orientation) {
  try {
    const bitmap = await createImageBitmap(file);
    state.bitmap = bitmap;
    setCanvasSize(bitmap.width, bitmap.height, orientation);
  } catch (err) {
    console.warn('createImageBitmap failed, fallback to Image()', err);
    await loadViaImageElement(file, orientation);
  }
}

function setCanvasSize(width, height, orientation) {
  const { scaledWidth, scaledHeight } = scaleDimensions(width, height);
  const canvas = els.canvas;
  if (orientation && orientation >= 5 && orientation <= 8) {
    canvas.width = scaledHeight;
    canvas.height = scaledWidth;
  } else {
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
  }
}

function scaleDimensions(width, height) {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= MAX_CANVAS_EDGE) {
    return { scaledWidth: width, scaledHeight: height };
  }
  const ratio = MAX_CANVAS_EDGE / maxEdge;
  return { scaledWidth: Math.round(width * ratio), scaledHeight: Math.round(height * ratio) };
}

async function loadViaImageElement(file, orientation) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // iOS fix for CORS
    
    img.onload = () => {
      state.bitmap = img;
      setCanvasSize(img.naturalWidth, img.naturalHeight, orientation);
      resolve();
    };
    
    img.onerror = (err) => {
      reject(new Error('Failed to load image'));
    };
    
    // iOS Safari requires blob URLs to work reliably
    if (state.originalURL) {
      img.src = state.originalURL;
    } else {
      const url = URL.createObjectURL(file);
      img.src = url;
    }
  });
}

function drawPreview() {
  const canvas = els.canvas;
  const ctx = canvas.getContext('2d');
  if (!state.bitmap) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    els.noImageNotice.hidden = false;
    return;
  }
  els.noImageNotice.hidden = true;
  drawImageWithOrientation(ctx, state.bitmap, state.meta.Orientation);
  drawOverlay(ctx);
}

function drawImageWithOrientation(ctx, source, orientation) {
  const canvas = ctx.canvas;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!orientation || orientation === 1) {
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  } else {
    applyOrientationTransform(ctx, canvas.width, canvas.height, orientation);
    ctx.drawImage(source, 0, 0, canvas.height, canvas.width);
  }
  ctx.restore();
}

function applyOrientationTransform(ctx, width, height, orientation) {
  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.translate(width, 0);
      ctx.rotate(0.5 * Math.PI);
      break;
    case 7:
      ctx.translate(width, height);
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.translate(0, height);
      ctx.rotate(-0.5 * Math.PI);
      break;
    default:
      break;
  }
}

// Paint the metadata overlay onto the current canvas frame.
function drawOverlay(ctx) {
  const canvas = ctx.canvas;
  ctx.save();
  // Prominent tiled watermark mode
  // Only apply the prominent watermark when the user captured/took the image (click image)
  if (state.prominentWatermark && state.captureMode === 'capture') {
    // Draw a single large diagonal watermark across the image using owner's contact or device label
    const wmText = (state.userContact && state.userContact.trim()) || state.userDeviceLabel || '';
    if (wmText) {
      const diag = Math.hypot(canvas.width, canvas.height);
      const wmSize = Math.max(28, Math.round(diag / 6));
      // Center and rotate -45deg for diagonal across image
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${wmSize}px "Inter", "Segoe UI", sans-serif`;
      // Use state.opacity for watermark alpha so user can control it via slider
      const alpha = Math.max(0.05, Math.min(0.95, state.opacity));
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.strokeStyle = `rgba(0,0,0,${Math.min(0.6, alpha * 0.8)})`;
      ctx.lineWidth = Math.max(2, Math.round(wmSize / 20));
      // Draw stroked + filled text for contrast
      ctx.strokeText(wmText, 0, 0);
      ctx.fillText(wmText, 0, 0);
      ctx.restore();
    }
  }

  // Default small overlay box (uses state.overlayText)
  const lines = (state.overlayText || '').split('\n').filter(Boolean);
  if (lines.length) {
    const fontSize = state.fontSize;
    const padding = Math.round(fontSize * 0.7);
    ctx.font = `${fontSize}px "Inter", "Segoe UI", sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = `rgba(15, 23, 42, ${state.opacity})`;
    ctx.strokeStyle = 'rgba(8, 145, 178, 0.35)';
    ctx.lineWidth = 1;
    const textMetrics = lines.map(line => ctx.measureText(line));
    const maxWidth = Math.max(...textMetrics.map(m => m.width));
    const height = fontSize * lines.length + padding + (lines.length - 1) * 6;
    const width = maxWidth + padding * 2;
    let x = padding;
    let y = ctx.canvas.height - height - padding;
    if (state.position === 'bottom-right') {
      x = ctx.canvas.width - width - padding;
    }
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height + padding, 12);
    } else {
      drawFallbackRoundRect(ctx, x, y, width, height + padding, 12);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    let textY = y + padding + fontSize;
    lines.forEach(line => {
      ctx.fillText(line, x + padding, textY);
      textY += fontSize + 6;
    });
  }
  ctx.restore();
}

function drawFallbackRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function detectOverlay(meta, fileName) {
  const alreadyBaked = Boolean(meta.UserComment && String(meta.UserComment).includes(OVERLAY_MARKER)) || /_metaview/i.test(fileName);
  els.overlayWarning.hidden = !alreadyBaked;
}

async function maybeAppendSignatureToOverlay() {
  // Signatures removed for MVP — no-op
  return Promise.resolve();
}

function enableExport(can) {
  if (!els.shareBtn.hidden) {
    els.shareBtn.disabled = !can;
  }
}

async function shareImage() {
  if (!state.bitmap || !navigator.share) {
    // Fallback if share not available
    if (!state.bitmap) return;
    await maybeAppendSignatureToOverlay();
    addOverlayMarker();
    const blob = await canvasToBlob(els.canvas);
    const filename = makeFileName();
    downloadBlob(blob, filename);
    return;
  }
  await maybeAppendSignatureToOverlay();
  addOverlayMarker();
  const blob = await canvasToBlob(els.canvas);
  const filename = makeFileName();
  try {
    await navigator.share({
      files: [new File([blob], filename, { type: blob.type })],
      title: 'MetaView export',
      text: generateCaption()
    });
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('Share failed, falling back to download', err);
      downloadBlob(blob, filename);
    }
  }
}

function generateCaption() {
  const timestamp = deriveTimestamp(state.meta) || '';
  const location = state.locationText || '';
  const device = state.meta.Model || '';
  const owner = state.userContact || '';
  const parts = [];
  if (owner) parts.push(owner);
  if (timestamp) parts.push(timestamp);
  if (location) parts.push(location);
  if (device) parts.push(device);
  const caption = parts.join(' | ');
  const verify = '\nVerify: metaview.app/verify';
  return caption + verify;
}

async function shareImportedImage() {
  if (!state.bitmap) {
    alert('No image loaded.');
    return;
  }
  
  // Build custom overlay text based on user selections
  let customOverlay = '';
  const timestamp = deriveTimestamp(state.meta) || 'Unknown time';
  const location = state.locationText || 'No GPS metadata';
  const device = state.meta.Model || 'Unknown device';
  
  if (state.shareOwnerOnly) {
    // Owner-only mode: use the owner's contact info (userContact)
    if (!state.userContact || !state.userContact.trim()) {
      alert('Please set the Owner contact in settings before sharing owner-only.');
      return;
    }
    customOverlay = state.userContact.trim();
  } else {
    // Build overlay from selected metadata
    const parts = [];
    if (state.shareTimestamp) parts.push(timestamp);
    if (state.shareLocation) parts.push(location);
    if (state.shareDevice) parts.push(device);
    customOverlay = parts.join('\n');
  }
  
  if (!customOverlay.trim()) {
    alert('Please select at least one metadata option to share.');
    return;
  }
  
  // Temporarily replace overlay text
  const originalOverlay = state.overlayText;
  state.overlayText = customOverlay;
  drawPreview();
  
  // Create blob and share
  const blob = await canvasToBlob(els.canvas);
  const filename = `metaview_${Date.now()}.jpg`;
  
  // Restore original overlay
  state.overlayText = originalOverlay;
  drawPreview();
  
  if (navigator.share) {
    try {
      await navigator.share({
        files: [new File([blob], filename, { type: blob.type })],
        title: 'Photo with selected metadata',
        text: 'Shared from MetaView'
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Share failed, falling back to download', err);
        downloadBlob(blob, filename);
      }
    }
  } else {
    downloadBlob(blob, filename);
  }
}

function addOverlayMarker() {
  if (!state.meta) return;
  let comment = OVERLAY_MARKER;
  // Add owner/contact information to metadata if provided
  if (state.userContact) {
    comment += ` | Owner: ${state.userContact}`;
  }
  state.meta.UserComment = comment;
}

function makeFileName() {
  const base = state.file?.name?.replace(/\.[^.]+$/, '') || 'metaview';
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return `${base}_metaview_${stamp}.jpg`;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode image'));
    }, 'image/jpeg', 0.92);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function saveSettings() {
  try {
    const s = {
      userDeviceLabel: state.userDeviceLabel || '',
      userContact: state.userContact || '',
      prominentWatermark: !!state.prominentWatermark,
    
    };
    await localStore.setItem(SETTINGS_KEY, s);
  } catch (err) {
    console.warn('Failed to save settings', err);
  }
}

async function loadSettings() {
  try {
    const s = await localStore.getItem(SETTINGS_KEY);
    if (s && typeof s === 'object') {
  state.userDeviceLabel = s.userDeviceLabel || '';
  state.userContact = s.userContact || '';
  state.prominentWatermark = !!s.prominentWatermark;
  if (els.deviceLabelInput) els.deviceLabelInput.value = state.userDeviceLabel;
  if (els.ownerInput) els.ownerInput.value = state.userContact;
  if (els.prominentWatermarkToggle) els.prominentWatermarkToggle.checked = state.prominentWatermark;
      updateOverlayText();
    }
  } catch (err) {
    console.warn('Failed to load settings', err);
  }
}

function updateMetaPanel() {
  const timestamp = deriveTimestamp(state.meta) || 'N/A';
  const location = state.locationText || 'No GPS metadata';
  const device = state.meta.Model || 'Unknown device';
  const privacy = state.reverseEnabled ? 'Reverse geocoding used (network)' : 'Local-only';
  const source = state.locationSource === 'device' ? 'Device GPS' : state.locationSource === 'exif' ? 'Photo metadata' : 'Unavailable';
  els.previewMeta.textContent = `Timestamp: ${timestamp} | Location: ${location} | Source: ${source} | Device: ${device} | Privacy: ${privacy}`;
}

function displayMetadataViewer() {
  if (!els.metadataContent) return;
  
  const meta = state.meta;
  const coords = getActiveCoords();
  
  const fields = [
    { label: 'Timestamp', value: deriveTimestamp(meta) || 'Not available' },
    { label: 'Device Model', value: meta.Model || 'Not available' },
    { label: 'Device Make', value: meta.Make || 'Not available' },
    { label: 'GPS Coordinates', value: coords ? formatCoords(coords.lat, coords.lon) : 'Not available' },
    { label: 'Location', value: state.locationText || 'Not available' },
    { label: 'Orientation', value: meta.Orientation || 'Not available' },
    { label: 'File Name', value: state.file?.name || 'Not available' },
    { label: 'File Size', value: state.file ? `${(state.file.size / 1024).toFixed(2)} KB` : 'Not available' },
    { label: 'File Type', value: state.file?.type || 'Not available' }
  ];
  
  let html = '<table class="metadata-table">';
  fields.forEach(field => {
    html += `<tr><td><strong>${field.label}:</strong></td><td>${field.value}</td></tr>`;
  });
  html += '</table>';
  
  els.metadataContent.innerHTML = html;
}
