import { MediaPipeTracker, getTrackingLabel } from './mediapipe.js';
import {
  Engine3D,
  FOLDER_CATALOG,
  folderToCategory,
  folderToLabel,
  probeFolder,
} from './engine3d.js';

const NOTIFICATION_DURATION = 4000;

const CATEGORIES = [
  { key: 'necklace', title: 'Necklace' },
  { key: 'earring', title: 'Earrings' },
  { key: 'ring', title: 'Ring' },
  { key: 'bracelet', title: 'Bracelet' },
];

const $ = (sel) => document.querySelector(sel);

const video = $('#video');
const canvas3d = $('#canvas3d');
const placeholder = $('#camera-placeholder');
const loadingOverlay = $('#loading-overlay');
const loadingText = $('#loading-text');
const btnStart = $('#btn-start');
const btnStop = $('#btn-stop');
const btnScreenshot = $('#btn-screenshot');
const trackingStatus = $('#tracking-status');
const trackingLabel = $('#tracking-label');
const jewelleryControls = $('#jewellery-controls');

const engine = new Engine3D(canvas3d);
const tracker = new MediaPipeTracker();

let stream = null;
let running = false;
let rafId = null;
let catalogue = [];
let latestTracking = null;
let lastLabel = '';
const activeByCategory = new Map();
const activeIds = new Set();
let notificationTimer = null;

injectNotificationStyles();

/* ── Chrome ───────────────────────────────────────────────────── */

function injectNotificationStyles() {
  if (document.getElementById('vto-notification-styles')) return;
  const style = document.createElement('style');
  style.id = 'vto-notification-styles';
  style.textContent = `
    .vto-notification {
      position: fixed;
      bottom: 1.5rem;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      z-index: 9999;
      padding: 0.75rem 1.5rem;
      background: rgba(20, 20, 20, 0.92);
      border: 1px solid rgba(212, 175, 55, 0.45);
      border-radius: 14px;
      color: #F5F0E8;
      font-family: 'Poppins', sans-serif;
      font-size: 0.875rem;
      letter-spacing: 0.03em;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(212,175,55,0.15);
      opacity: 0;
      transition: opacity 0.28s ease, transform 0.28s ease;
      pointer-events: none;
      max-width: 90vw;
      text-align: center;
    }
    .vto-notification.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .jewellery-btn {
      transition: transform 0.22s cubic-bezier(0.4,0,0.2,1),
                  box-shadow 0.22s cubic-bezier(0.4,0,0.2,1),
                  background 0.22s cubic-bezier(0.4,0,0.2,1),
                  border-color 0.22s cubic-bezier(0.4,0,0.2,1),
                  color 0.22s cubic-bezier(0.4,0,0.2,1);
    }
    .jewellery-btn.active {
      transform: scale(1.04);
      animation: luxuryPulse 0.35s ease;
    }
    @keyframes luxuryPulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.06); }
      100% { transform: scale(1.04); }
    }
  `;
  document.head.appendChild(style);
}

function showNotification(message) {
  let el = document.getElementById('vto-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'vto-notification';
    el.className = 'vto-notification';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }

  clearTimeout(notificationTimer);
  el.textContent = message;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');

  notificationTimer = setTimeout(() => el.classList.remove('show'), NOTIFICATION_DURATION);
}

function setTrackingUI(label, state) {
  if (label === lastLabel) return;
  lastLabel = label;
  trackingLabel.textContent = label;
  trackingStatus.className = `status-dot ${state}`;
}

function showLoading(message) {
  if (loadingText) loadingText.textContent = message;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

/* ── Viewport ─────────────────────────────────────────────────── */

function resizeViewport() {
  const wrapper = video.parentElement;
  const rect = wrapper.getBoundingClientRect();
  engine.resize(rect.width, rect.height);
  engine.setVideoSize(video.videoWidth, video.videoHeight);
}

/* ── Catalogue ────────────────────────────────────────────────── */

async function discoverCatalogue() {
  const results = await Promise.all(FOLDER_CATALOG.map(probeFolder));
  catalogue = results
    .map((r) => {
      const category = folderToCategory(r.folder);
      if (!category) return null;
      return {
        id: r.folder,
        folder: r.folder,
        category,
        label: folderToLabel(r.folder),
        objFile: r.objFile,
        available: r.available,
      };
    })
    .filter(Boolean);

  const missing = catalogue.filter((c) => !c.available).map((c) => c.folder);
  if (missing.length) {
    console.warn(
      `[Catalogue] no model found in: ${missing.join(', ')}\n` +
      'Drop a model.obj into objects/<folder>/ to enable those buttons.',
    );
  }
}

function buildJewelleryUI() {
  jewelleryControls.innerHTML = '';

  for (const cat of CATEGORIES) {
    const items = catalogue.filter((c) => c.category === cat.key);
    if (!items.length) continue;

    const group = document.createElement('div');
    group.className = 'jewellery-group';

    const title = document.createElement('h2');
    title.className = 'group-title';
    title.textContent = cat.title;
    group.appendChild(title);

    const buttons = document.createElement('div');
    buttons.className = 'jewellery-buttons';

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jewellery-btn';
      btn.textContent = item.label;
      btn.dataset.id = item.id;
      btn.dataset.category = item.category;
      btn.setAttribute('aria-label', `Toggle ${item.label}`);

      if (!item.available) {
        btn.classList.add('unavailable');
        btn.disabled = true;
        btn.title = `No model in objects/${item.folder}/`;
        btn.setAttribute('aria-label', `${item.label} — no model file yet`);
      } else {
        btn.addEventListener('click', () => toggleJewellery(item, btn));
      }

      buttons.appendChild(btn);
    }

    group.appendChild(buttons);
    jewelleryControls.appendChild(group);
  }
}

function getButton(id) {
  return jewelleryControls.querySelector(`[data-id="${id}"]`);
}

function setButtonState(btn, state) {
  btn.classList.remove('active', 'loading');
  if (state === 'on') btn.classList.add('active');
  if (state === 'loading') btn.classList.add('loading');
}

function syncTrackerNeeds() {
  const need = engine.requiredTrackers();
  tracker.setNeeds(need);

  // Start pulling the models we're about to need, so the first tracked frame
  // isn't the one that pays for the download.
  const keys = ['face', 'hands', 'pose'].filter((k) => need[k]);
  tracker.warmup(keys.length ? keys : ['face']);
}

async function toggleJewellery(item, btn) {
  if (btn.classList.contains('loading')) return;

  if (activeIds.has(item.id)) {
    engine.deactivate(item.id);
    activeIds.delete(item.id);
    activeByCategory.delete(item.category);
    setButtonState(btn, 'off');
    syncTrackerNeeds();
    showNotification(`${item.label} OFF`);
    return;
  }

  // Only one item per category at a time.
  const prev = activeByCategory.get(item.category);
  if (prev) {
    engine.deactivate(prev.id);
    activeIds.delete(prev.id);
    const prevBtn = getButton(prev.id);
    if (prevBtn) setButtonState(prevBtn, 'off');
  }

  setButtonState(btn, 'loading');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  showLoading(`Loading ${item.label}…`);

  try {
    const template = await engine.loadJewellery(
      item.id,
      item.folder,
      item.objFile,
      item.category,
      (fraction) => showLoading(`Loading ${item.label}… ${Math.round(fraction * 100)}%`),
    );
    engine.activate(item.id, template);
    activeIds.add(item.id);
    activeByCategory.set(item.category, item);
    setButtonState(btn, 'on');
    syncTrackerNeeds();
    showNotification(`${item.label} ON`);
    window.__vtoTuner?.refresh();
  } catch (err) {
    console.error('[Load] failed for', item.folder, err);
    setButtonState(btn, 'off');
    showNotification(`Could not load ${item.label}. See the console for details.`);
  } finally {
    hideLoading();
    btn.textContent = item.label;
    btn.disabled = false;
  }
}

/* ── Camera + loops ───────────────────────────────────────────── */

async function startCamera() {
  try {
    setTrackingUI('Starting camera…', 'loading');

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) {
      await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
    }

    video.style.display = 'block';
    placeholder.classList.add('hidden');

    btnStart.disabled = true;
    btnStop.disabled = false;
    btnScreenshot.disabled = false;

    // Tracking failing must not take the camera preview down with it — the
    // models download lazily, so this only throws if the CDN scripts are
    // genuinely missing.
    if (!tracker.ready) {
      try {
        await tracker.init();
      } catch (err) {
        console.error('[Tracker] init failed', err);
        showNotification(tracker.lastError || 'AI tracking could not start.');
      }
    }

    running = true;
    resizeViewport();
    syncTrackerNeeds();
    setTrackingUI(tracker.ready ? 'Camera Ready' : 'Tracking unavailable',
      tracker.ready ? 'tracking' : 'offline');

    renderLoop();
    trackingPump();
  } catch (err) {
    console.error('[Camera] start failed', err);
    setTrackingUI('Camera permission denied', 'offline');
    showNotification('Unable to access camera. Please allow camera permission.');
  }
}

function stopCamera() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  video.srcObject = null;
  video.style.display = 'none';
  placeholder.classList.remove('hidden');

  btnStart.disabled = false;
  btnStop.disabled = true;
  btnScreenshot.disabled = true;

  tracker.reset();
  latestTracking = null;
  engine.hideAll();
  engine.render();
  setTrackingUI('Camera off', 'offline');
}

/**
 * Rendering runs on its own rAF loop, independent of tracking. Even when the
 * ML solutions only manage 10fps, the overlay keeps interpolating at display
 * rate — and a thrown error can no longer break the chain, because the next
 * frame is queued before any work happens.
 */
function renderLoop() {
  if (!running) return;
  rafId = requestAnimationFrame(renderLoop);
  try {
    engine.update(latestTracking);
    engine.render();
  } catch (err) {
    console.error('[Render] frame failed', err);
  }
}

/** Tracking runs as fast as it can, and never blocks rendering. */
async function trackingPump() {
  while (running) {
    try {
      latestTracking = await tracker.processFrame(video);

      const activeCategories = [...activeByCategory.values()].map((i) => i.category);

      let label;
      let state;
      if (!tracker.ready) {
        label = 'Tracking unavailable';
        state = 'offline';
      } else if (!tracker.warm && activeCategories.length) {
        // First frame is still downloading the WASM + model files.
        label = 'Loading AI model…';
        state = 'loading';
      } else {
        label = getTrackingLabel(latestTracking, activeCategories);
        state = label === 'Camera off' ? 'offline'
          : (label.startsWith('Tracking') || label === 'Camera Ready') ? 'tracking'
          : 'loading';
      }
      setTrackingUI(label, state);
    } catch (err) {
      console.warn('[Tracking] frame failed', err);
    }
    await nextFrame();
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function captureScreenshot() {
  if (!running || video.readyState < 2) return;
  const dataUrl = engine.screenshot(video);
  const link = document.createElement('a');
  link.download = `jewellery-tryon-${Date.now()}.png`;
  link.href = dataUrl;
  link.click();
  showNotification('Screenshot saved');
}

/* ── Boot ─────────────────────────────────────────────────────── */

async function init() {
  resizeViewport();
  window.addEventListener('resize', resizeViewport);
  window.addEventListener('orientationchange', () => setTimeout(resizeViewport, 250));
  video.addEventListener('loadedmetadata', resizeViewport);

  btnStart.addEventListener('click', startCamera);
  btnStop.addEventListener('click', stopCamera);
  btnScreenshot.addEventListener('click', captureScreenshot);

  setTrackingUI('Camera off', 'offline');
  await discoverCatalogue();
  buildJewelleryUI();

  if (new URLSearchParams(location.search).has('tune')) {
    const { createTuner } = await import('./tuning.js');
    window.__vtoTuner = createTuner(engine, () => [...activeByCategory.values()]);
  }
}

init();
