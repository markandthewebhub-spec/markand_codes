/* Landmark smoothing factor. Higher = snappier, lower = steadier. */
const SMOOTH_LANDMARK = 0.5;

/* How long a single solution may take before we give up on this frame.
   Without this, one stalled callback froze the whole render loop forever. */
const FRAME_TIMEOUT_MS = 900;

/* The very first frame also downloads several MB of WASM and model data,
   which on a phone over a tunnel is nowhere near a 900ms job. */
const WARMUP_TIMEOUT_MS = 60000;

/* How many consecutive misses before we declare tracking lost and let the
   jewellery fade out (instead of freezing at its last position). */
const MISS_GRACE = 4;

const CDN = {
  face: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
  hands: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
  pose: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose',
};

export class MediaPipeTracker {
  constructor() {
    this.faceMesh = null;
    this.hands = null;
    this.pose = null;
    this.ready = false;

    /* Which solutions actually initialised. A solution that failed to load
       is never sent to again, so it can't stall the frame. */
    this.available = { face: false, hands: false, pose: false };

    /* Which solutions the current selection needs. */
    this.needs = { face: true, hands: false, pose: false };
    this.handCount = 1;

    this.face = null;
    this.poseLm = null;
    this.leftHand = null;
    this.rightHand = null;

    this.trackingFace = false;
    this.trackingHands = false;
    this.trackingPose = false;

    this._miss = { face: 0, hands: 0, pose: 0, left: 0, right: 0 };
    this._resolvers = { face: null, hands: null, pose: null };
    this._fails = { face: 0, hands: 0, pose: 0 };
    this._warmed = { face: false, hands: false, pose: false };
    this._busy = false;

    /* True once a frame has completed end to end. Until then the models are
       still downloading, so frames get a much longer grace period. */
    this.warm = false;
    this.lastError = null;
  }

  /**
   * Builds the solutions but does NOT download their models yet.
   *
   * Each solution pulls several MB of WASM plus a model file. Waiting for all
   * three up front means a slow phone connection blows past any sane timeout
   * and the whole app reports itself broken — even though the models would
   * have arrived a few seconds later. Instead the first send() to a solution
   * loads it on demand, and only the solutions the current selection actually
   * needs are ever touched.
   */
  async init() {
    const missing = [];
    if (typeof FaceMesh === 'undefined') missing.push('face_mesh.js');
    if (typeof Hands === 'undefined') missing.push('hands.js');
    if (typeof Pose === 'undefined') missing.push('pose.js');

    if (missing.length === 3) {
      this.lastError =
        `MediaPipe scripts did not load (${missing.join(', ')}). ` +
        'Check the connection to cdn.jsdelivr.net.';
      throw new Error(this.lastError);
    }
    if (missing.length) console.warn('[Tracker] missing MediaPipe bundles:', missing);

    if (typeof FaceMesh !== 'undefined') {
      this.faceMesh = new FaceMesh({ locateFile: (f) => `${CDN.face}/${f}` });
      this.faceMesh.setOptions({
        maxNumFaces: 1,
        // Kept off: the extra iris points push the count from 468 to 478 and
        // buy nothing here, while costing real CPU time.
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.faceMesh.onResults((r) => this._onFace(r));
      this.available.face = true;
    }

    if (typeof Hands !== 'undefined') {
      this.hands = new Hands({ locateFile: (f) => `${CDN.hands}/${f}` });
      this.hands.setOptions({
        maxNumHands: this.handCount,
        modelComplexity: 0,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.hands.onResults((r) => this._onHands(r));
      this.available.hands = true;
    }

    if (typeof Pose !== 'undefined') {
      this.pose = new Pose({ locateFile: (f) => `${CDN.pose}/${f}` });
      this.pose.setOptions({
        modelComplexity: 0,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.pose.onResults((r) => this._onPose(r));
      this.available.pose = true;
    }

    this.ready = true;
    console.log('[Tracker] solutions created (models load on first use)', this.available);
  }

  /**
   * Starts downloading a solution's model in the background. Nothing awaits
   * this — it just gets a head start so the first real frame isn't the thing
   * that pays for the download.
   */
  warmup(keys = ['face']) {
    for (const key of keys) {
      const solution = this._solution(key);
      if (!solution || this._warmed[key]) continue;
      this._warmed[key] = true;
      try {
        Promise.resolve(solution.initialize()).catch((err) =>
          console.warn(`[Tracker] ${key} warmup failed (will retry on use)`, err));
      } catch (err) {
        console.warn(`[Tracker] ${key} warmup threw`, err);
      }
    }
  }

  _solution(key) {
    if (key === 'face') return this.faceMesh;
    if (key === 'hands') return this.hands;
    if (key === 'pose') return this.pose;
    return null;
  }

  /** Tell the tracker which solutions the active jewellery actually needs. */
  setNeeds(needs) {
    this.needs = {
      face: !!needs.face,
      hands: !!needs.hands,
      pose: !!needs.pose,
    };
    if (!this.needs.face) this._clear('face');
    if (!this.needs.hands) this._clear('hands');
    if (!this.needs.pose) this._clear('pose');

    // Paired bracelets need both wrists; everything else runs cheaper on one.
    const want = needs.handCount === 2 ? 2 : 1;
    if (want !== this.handCount) {
      this.handCount = want;
      if (this.hands && this.available.hands) {
        try {
          this.hands.setOptions({ maxNumHands: want });
        } catch (err) {
          console.warn('[Tracker] could not change maxNumHands', err);
        }
      }
    }
  }

  _clear(key) {
    if (key === 'face') { this.face = null; this.trackingFace = false; }
    if (key === 'hands') {
      this.leftHand = null;
      this.rightHand = null;
      this.trackingHands = false;
      this._miss.left = this._miss.right = 0;
    }
    if (key === 'pose') { this.poseLm = null; this.trackingPose = false; }
    this._miss[key] = 0;
  }

  _smooth(prev, next) {
    if (!next || !next.length) return null;
    if (!prev || prev.length !== next.length) {
      return next.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z || 0, visibility: lm.visibility }));
    }
    const out = new Array(next.length);
    for (let i = 0; i < next.length; i++) {
      out[i] = {
        x: prev[i].x + (next[i].x - prev[i].x) * SMOOTH_LANDMARK,
        y: prev[i].y + (next[i].y - prev[i].y) * SMOOTH_LANDMARK,
        z: (prev[i].z || 0) + ((next[i].z || 0) - (prev[i].z || 0)) * SMOOTH_LANDMARK,
        visibility: next[i].visibility,
      };
    }
    return out;
  }

  _onFace(results) {
    this._fails.face = 0; // results came back, so the solution is alive
    const raw = results?.multiFaceLandmarks?.[0];
    if (raw && raw.length) {
      this.face = this._smooth(this.face, raw);
      this.trackingFace = true;
      this._miss.face = 0;
    } else if (++this._miss.face >= MISS_GRACE) {
      this.face = null;
      this.trackingFace = false;
    }
    this._resolve('face');
  }

  _onHands(results) {
    this._fails.hands = 0;
    const list = results?.multiHandLandmarks;

    if (!list || !list.length) {
      if (++this._miss.hands >= MISS_GRACE) {
        this.leftHand = null;
        this.rightHand = null;
        this.trackingHands = false;
      }
      this._miss.left = this._miss.right = MISS_GRACE;
      this._resolve('hands');
      return;
    }

    this._miss.hands = 0;
    this.trackingHands = true;

    // "left"/"right" here are just stable slot names — MediaPipe's handedness
    // labels assume a mirrored input, and all we need is for the same physical
    // hand to keep the same slot every frame.
    const hands = list.map((landmarks, i) => ({
      landmarks,
      label: results.multiHandedness?.[i]?.label === 'Left' ? 'left' : 'right',
      x: landmarks[0]?.x ?? 0.5,
    }));

    let slotLeft = null;
    let slotRight = null;

    if (hands.length >= 2 && hands[0].label === hands[1].label) {
      // Labels collided — fall back to screen order so the two copies can't
      // both pile onto the same slot.
      const sorted = [...hands].sort((a, b) => a.x - b.x);
      slotLeft = sorted[0].landmarks;
      slotRight = sorted[1].landmarks;
    } else {
      for (const h of hands) {
        if (h.label === 'left') slotLeft = h.landmarks;
        else slotRight = h.landmarks;
      }
    }

    // Each slot keeps its own grace period, so a one-frame handedness flip
    // doesn't make a bracelet jump to the other wrist and back.
    this.leftHand = this._slot('left', 'leftHand', slotLeft);
    this.rightHand = this._slot('right', 'rightHand', slotRight);

    this._resolve('hands');
  }

  _slot(key, prop, landmarks) {
    if (landmarks) {
      this._miss[key] = 0;
      return this._smooth(this[prop], landmarks);
    }
    if (++this._miss[key] >= MISS_GRACE) return null;
    return this[prop];
  }

  _onPose(results) {
    this._fails.pose = 0;
    const raw = results?.poseLandmarks;
    if (raw && raw.length) {
      this.poseLm = this._smooth(this.poseLm, raw);
      this.trackingPose = true;
      this._miss.pose = 0;
    } else if (++this._miss.pose >= MISS_GRACE) {
      this.poseLm = null;
      this.trackingPose = false;
    }
    this._resolve('pose');
  }

  _resolve(key) {
    const fn = this._resolvers[key];
    this._resolvers[key] = null;
    if (fn) fn();
  }

  /** Sends one frame to one solution. Always settles, even on throw. */
  _send(key, video) {
    const solution = this._solution(key);
    this._warmed[key] = true;
    return new Promise((resolve) => {
      this._resolvers[key] = resolve;
      try {
        const p = solution.send({ image: video });
        if (p && typeof p.then === 'function') {
          // onResults normally settles this first; these are the safety nets
          // for the case where it never fires at all.
          p.then(() => this._resolve(key), (err) => this._sendFailed(key, err));
        }
      } catch (err) {
        this._sendFailed(key, err);
      }
    });
  }

  _sendFailed(key, err) {
    if (++this._fails[key] >= 5) {
      this.available[key] = false;
      console.error(`[Tracker] ${key} failed ${this._fails[key]}x — disabling it`, err);
    } else {
      console.warn(`[Tracker] ${key} send failed (${this._fails[key]}/5)`, err);
    }
    this._resolve(key);
  }

  /**
   * Processes one frame.
   *
   * Two separate guards, deliberately: `_busy` is released only when the
   * sends genuinely settle, so a slow first frame can't pile up more sends
   * behind it — while the `await` below is bounded by a timeout, so the
   * render loop is never held hostage by a stalled solution.
   */
  async processFrame(video) {
    if (!this.ready || !video || video.readyState < 2 || this._busy) {
      return this.getTracking();
    }

    const jobs = [];
    if (this.needs.face && this.available.face && this.faceMesh) jobs.push(this._send('face', video));
    if (this.needs.hands && this.available.hands && this.hands) jobs.push(this._send('hands', video));
    if (this.needs.pose && this.available.pose && this.pose) jobs.push(this._send('pose', video));

    if (!jobs.length) return this.getTracking();

    this._busy = true;
    const settled = Promise.all(jobs).finally(() => { this._busy = false; });

    try {
      // The first frame also pays for downloading the models, which on a
      // phone can take a while. Only afterwards do we hold frames to a
      // real-time budget.
      await withTimeout(settled, this.warm ? FRAME_TIMEOUT_MS : WARMUP_TIMEOUT_MS, 'frame');
      this.warm = true;
    } catch {
      /* dropped frame — the next one just carries on */
    }
    return this.getTracking();
  }

  getPrimaryHand() {
    return this.rightHand || this.leftHand || null;
  }

  getTracking() {
    return {
      face: this.face,
      pose: this.poseLm,
      leftHand: this.leftHand,
      rightHand: this.rightHand,
      primaryHand: this.getPrimaryHand(),
      trackingFace: this.trackingFace,
      trackingHands: this.trackingHands,
      trackingPose: this.trackingPose,
      isTracking: this.trackingFace || this.trackingHands,
    };
  }

  reset() {
    this._clear('face');
    this._clear('hands');
    this._clear('pose');
    this._busy = false;
    this._resolvers = { face: null, hands: null, pose: null };
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

export function getTrackingLabel(tracking, activeCategories) {
  if (!tracking) return 'Camera off';

  const needs = activeCategories || [];
  const needsFace = needs.some((c) => c === 'necklace' || c === 'earring');
  const needsHand = needs.some((c) => c === 'ring' || c === 'bracelet');

  if (needsFace && tracking.trackingFace) return 'Tracking Face';
  if (needsHand && tracking.trackingHands) return 'Tracking Hand';
  if (needsFace && needsHand) return 'Show face or hand';
  if (needsFace) return 'Looking for face…';
  if (needsHand) return 'Show your hand';
  return 'Camera Ready';
}
