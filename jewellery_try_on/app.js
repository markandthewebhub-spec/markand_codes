/**
 * Jewellery Try On – Main Application
 */

import { MediaPipeTracker } from './mediapipe.js';
import { Engine3D } from './engine3d.js';

const CATEGORY_LABELS = {
  earring: 'Earrings',
  necklace: 'Necklaces',
  ring: 'Rings',
  bracelet: 'Bracelets',
};

const CATEGORY_ORDER = ['earring', 'necklace', 'ring', 'bracelet'];

const JEWELLERY_CATALOG = [
  { id: 'earring-gold', category: 'earring', style: 'gold', label: 'Gold Earring', folder: 'objects/earring-gold' },
  { id: 'earring-diamond', category: 'earring', style: 'diamond', label: 'Diamond Earring', folder: 'objects/earring-diamond' },
  { id: 'earring-hoop', category: 'earring', style: 'hoop', label: 'Hoop Earring', folder: 'objects/earring-hoop' },
  { id: 'necklace-gold', category: 'necklace', style: 'gold', label: 'Gold Necklace', folder: 'objects/necklace-gold' },
  { id: 'necklace-diamond', category: 'necklace', style: 'diamond', label: 'Diamond Necklace', folder: 'objects/necklace-diamond' },
  { id: 'necklace-mala', category: 'necklace', style: 'mala', label: 'Mala Necklace', folder: 'objects/necklace-mala' },
  { id: 'ring-band', category: 'ring', style: 'band', label: 'Band Ring', folder: 'objects/ring-band' },
  { id: 'ring-solitaire', category: 'ring', style: 'solitaire', label: 'Solitaire Ring', folder: 'objects/ring-solitaire' },
  { id: 'bracelet-gold', category: 'bracelet', style: 'gold', label: 'Gold Bracelet', folder: 'objects/bracelet-gold' },
  { id: 'bracelet-diamond', category: 'bracelet', style: 'diamond', label: 'Diamond Bracelet', folder: 'objects/bracelet-diamond' },
];

class JewelleryTryOnApp {
  constructor() {
    this.video = document.getElementById('video');
    this.canvas = document.getElementById('canvas3d');
    this.tracker = null;
    this.engine = null;
    this.isCameraActive = false;
    this.activeItemId = null;
    this.loadingItems = new Set();
    this.availableModels = new Map();
    this.hadFaceTracking = false;

    this._bindElements();
    this._bindEvents();
    this._initEngine();
    this._checkAvailableModels();
    this._renderJewelleryList();
  }

  _bindElements() {
    this.btnStart = document.getElementById('btn-start');
    this.btnStop = document.getElementById('btn-stop');
    this.btnScreenshot = document.getElementById('btn-screenshot');
    this.jewelleryControls = document.getElementById('jewellery-controls');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.cameraPlaceholder = document.getElementById('camera-placeholder');
    this.trackingStatus = document.getElementById('tracking-status');
    this.trackingLabel = document.getElementById('tracking-label');
  }

  _bindEvents() {
    this.btnStart.addEventListener('click', () => this.startCamera());
    this.btnStop.addEventListener('click', () => this.stopCamera());
    this.btnScreenshot.addEventListener('click', () => this.captureScreenshot());

    this.jewelleryControls.addEventListener('click', (e) => {
      const btn = e.target.closest('.jewellery-btn');
      if (!btn || btn.classList.contains('loading') || btn.classList.contains('unavailable')) return;
      this.toggleJewelleryButton(btn);
    });
  }

  _setStatus(state, label) {
    this.trackingStatus.className = `status-dot ${state}`;
    this.trackingLabel.textContent = label;
  }

  toggleJewelleryButton(button) {
    if (!this.isCameraActive) {
      this._showError('Please start the camera before trying on jewellery.');
      return;
    }

    const id = button.dataset.id;

    if (button.classList.contains('active')) {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
      this.activeItemId = null;
      this.engine.setJewelleryVisible(id, false);
      return;
    }

    if (this.activeItemId) {
      this.engine.setJewelleryVisible(this.activeItemId, false);
      this.engine.deactivateJewellery(this.activeItemId);
    }

    document.querySelectorAll('.jewellery-btn').forEach((btn) => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });

    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
    this.activeItemId = id;
    this._loadAndShowJewellery(id);
  }

  _initEngine() {
    this.engine = new Engine3D(this.canvas, this.video);
    this.engine.init();
    this._startRenderLoop();
  }

  _startRenderLoop() {
    const loop = () => {
      this.engine.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async _checkAvailableModels() {
    for (const item of JEWELLERY_CATALOG) {
      const exists = await this.engine.verifyModelFile(item.folder);
      this.availableModels.set(item.id, exists);
    }
    this._renderJewelleryList();
  }

  async _verifyModelAvailable(id) {
    const item = JEWELLERY_CATALOG.find((j) => j.id === id);
    if (!item) return false;

    const exists = await this.engine.verifyModelFile(item.folder);
    this.availableModels.set(id, exists);
    this._renderJewelleryList();
    return exists;
  }

  _renderJewelleryList() {
    this.jewelleryControls.innerHTML = CATEGORY_ORDER.map((category) => {
      const items = JEWELLERY_CATALOG.filter((item) => item.category === category);
      const buttons = items.map((item) => {
        const available = this.availableModels.get(item.id) === true;
        const isActive = this.activeItemId === item.id;
        const isLoading = this.loadingItems.has(item.id);
        const btnLabel = `${item.style.charAt(0).toUpperCase() + item.style.slice(1)} ${CATEGORY_LABELS[category].replace(/s$/, '')}`;

        return `
          <button type="button"
                  class="jewellery-btn ${isActive ? 'active' : ''} ${isLoading ? 'loading' : ''} ${!available ? 'unavailable' : ''}"
                  data-id="${item.id}"
                  data-category="${category}"
                  aria-pressed="${isActive}"
                  ${!available ? 'disabled' : ''}>
            ${btnLabel}
          </button>
        `;
      }).join('');

      return `
        <div class="jewellery-group" data-group="${category}">
          <h2 class="group-title">${CATEGORY_LABELS[category]}</h2>
          <div class="jewellery-buttons">${buttons}</div>
        </div>
      `;
    }).join('');
  }

  async _loadAndShowJewellery(id) {
    const item = JEWELLERY_CATALOG.find((j) => j.id === id);
    if (!item) return;

    if (!this.isCameraActive) {
      this._clearActiveButton();
      return;
    }

    const exists = await this._verifyModelAvailable(id);
    if (!exists) {
      this.engine.invalidateModel(id);
      this._clearActiveButton();
      this._showError(`Model not found: ${item.label}. Add model.obj to ${item.folder}/`);
      return;
    }

    this.loadingItems.add(id);
    this._renderJewelleryList();
    this._restoreActiveStates();
    this._showLoading(true);

    try {
      this.engine.invalidateModel(id);
      const model = await this.engine.loadModel(id, item.folder, id);
      this.engine.activateJewellery(id, id, model);
      this.engine.setJewelleryVisible(id, true);
    } catch (err) {
      console.error(`Failed to load ${id}:`, err);
      this.engine.invalidateModel(id);
      this.availableModels.set(id, false);
      this._clearActiveButton();
      this._showError(`Failed to load ${item.label}. Check model.obj and model.mtl files.`);
    } finally {
      this.loadingItems.delete(id);
      this._showLoading(false);
      this._renderJewelleryList();
      this._restoreActiveStates();
    }
  }

  _clearActiveButton() {
    this.activeItemId = null;
    document.querySelectorAll('.jewellery-btn').forEach((btn) => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
  }

  _restoreActiveStates() {
    if (!this.activeItemId) return;
    const btn = this.jewelleryControls.querySelector(
      `.jewellery-btn[data-id="${this.activeItemId}"]`
    );
    if (btn && !btn.disabled) {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    }
  }

  _showError(message) {
    this._setStatus('offline', message);
    setTimeout(() => {
      if (this.isCameraActive) {
        this._setStatus('tracking', 'Camera Active');
      } else {
        this._setStatus('offline', 'Camera off');
      }
    }, 3500);
  }

  async startCamera() {
    if (this.isCameraActive) return;

    this._setStatus('loading', 'Initializing…');

    try {
      this.tracker = new MediaPipeTracker(this.video);
      this._setStatus('loading', 'Starting Camera…');
      await this.tracker.init();

      this.tracker.onResults((data) => {
        this.engine.updateTracking(data);
        this._updateTrackingStatus(data);
      });

      await this.tracker.start();

      this.video.style.display = 'block';
      this.cameraPlaceholder.classList.add('hidden');
      this.isCameraActive = true;
      this.hadFaceTracking = false;
      this.engine.setCameraActive(true);

      this.btnStart.disabled = true;
      this.btnStop.disabled = false;
      this.btnScreenshot.disabled = false;

      this.engine.resize();
      this._setStatus('tracking', 'Camera Active');
    } catch (err) {
      console.error('Camera error:', err);
      this.engine.setCameraActive(false);
      this._setStatus('offline', 'Camera access denied');
      alert('Unable to access camera. Please allow camera permissions and try again.');
    }
  }

  stopCamera() {
    if (!this.isCameraActive) return;

    this.tracker?.stop();
    this.tracker = null;

    const stream = this.video.srcObject;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      this.video.srcObject = null;
    }

    this.video.style.display = 'none';
    this.cameraPlaceholder.classList.remove('hidden');
    this.isCameraActive = false;
    this.hadFaceTracking = false;
    this.activeItemId = null;

    this.engine.setCameraActive(false);
    this.engine.updateTracking(null);
    this._clearActiveButton();

    this.btnStart.disabled = false;
    this.btnStop.disabled = true;
    this.btnScreenshot.disabled = true;

    this._setStatus('offline', 'Camera off');
    this._renderJewelleryList();
  }

  _updateTrackingStatus(data) {
    if (!this.isCameraActive) return;

    if (data.hasFace) {
      this.hadFaceTracking = true;
      this._setStatus('tracking', 'Tracking Face');
      return;
    }

    if (this.hadFaceTracking) {
      this._setStatus('loading', 'Tracking Lost');
      return;
    }

    this._setStatus('tracking', 'Camera Active');
  }

  captureScreenshot() {
    if (!this.isCameraActive) return;

    const dataUrl = this.engine.captureScreenshot();
    const link = document.createElement('a');
    link.download = `jewellery_try_on-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }

  _showLoading(show) {
    this.loadingOverlay.classList.toggle('hidden', !show);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new JewelleryTryOnApp();
});
