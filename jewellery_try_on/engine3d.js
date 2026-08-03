import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

/* ────────────────────────────────────────────────────────────────
   MediaPipe FaceMesh / Pose / Hands landmark indices
   ──────────────────────────────────────────────────────────────── */

const FACE = {
  chin: 152,
  leftJaw: 234,
  rightJaw: 454,
  forehead: 10,
  leftLobe: 132,
  rightLobe: 361,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
};

const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
};

const HAND = {
  wrist: 0,
  indexMcp: 5,
  middleMcp: 9,
  ringMcp: 13,
  ringPip: 14,
  ringTip: 16,
  pinkyMcp: 17,
};

/* ────────────────────────────────────────────────────────────────
   PER-FOLDER TUNING
   Add your own OBJ, then nudge it here. Everything is optional.

     rotX / rotY / rotZ : extra rotation in DEGREES, applied after the
                          automatic bounding-box orientation.
     scale              : size multiplier. 1 = whatever auto-fit picked.
     offsetX / offsetY  : nudge, measured in multiples of the item's own
     offsetZ              size. 0.1 = move by 10% of the item's width.
     autoOrient         : false to switch off the bounding-box guess and
                          use only your rotX/rotY/rotZ values.
     anchor             : 'top' (item hangs from the tracking point) or
                          'center' (tracking point sits in the middle).

   Tip: open the page with  ?tune=1  to get live sliders that print a
   ready-to-paste block for this table.
   ──────────────────────────────────────────────────────────────── */

export const MODEL_TUNING = {
  // 'necklace-diamond': { rotX: 0, rotY: 0, rotZ: 0, scale: 1, offsetY: 0 },
  // 'ring-band':        { rotX: 0, scale: 1.1 },
};

/*
 * `pair: 2` means one uploaded model is duplicated into a left/right pair.
 * `pairMirror` mirrors the second copy — correct for earrings, which really
 * are mirror-image twins. A bracelet moved from one wrist to the other is
 * the same object rotated, not mirrored, so it stays off there.
 */
const CATEGORY_DEFAULTS = {
  necklace: { fitAxis: 'x', anchor: 'top', scale: 1, pair: 1, pairMirror: false },
  earring: { fitAxis: 'y', anchor: 'top', scale: 1, pair: 2, pairMirror: true },
  ring: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 1, pairMirror: false },
  bracelet: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 2, pairMirror: false },
};

/* Smoothing. Higher = snappier but more jitter. */
const SMOOTH = 0.4;
const FADE_SPEED = 0.18;
const DEG = Math.PI / 180;

/* Scratch objects. NOTE: every helper below takes an explicit `out`
   target — returning a shared temp is what broke positioning before. */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _bUp = new THREE.Vector3();
const _bRight = new THREE.Vector3();
const _bFwd = new THREE.Vector3();
const _bm4 = new THREE.Matrix4();

/**
 * Builds a guaranteed-orthonormal rotation from an "up" axis plus a rough
 * "right" hint. Degenerate / zero / parallel inputs fall back to something
 * sane instead of producing a non-unit quaternion (which silently shrinks
 * and flips the model).
 */
function basisQuat(primaryUp, refRight, outQuat) {
  _bUp.copy(primaryUp);
  if (_bUp.lengthSq() < 1e-12) _bUp.set(0, 1, 0);
  _bUp.normalize();

  _bRight.copy(refRight);
  if (_bRight.lengthSq() < 1e-12) _bRight.set(1, 0, 0);
  _bRight.normalize();

  _bFwd.crossVectors(_bRight, _bUp);
  if (_bFwd.lengthSq() < 1e-8) {
    // up and right are parallel — pick any perpendicular axis
    if (Math.abs(_bUp.x) < 0.9) _bRight.set(1, 0, 0);
    else _bRight.set(0, 1, 0);
    _bFwd.crossVectors(_bRight, _bUp);
  }
  _bFwd.normalize();
  _bRight.crossVectors(_bUp, _bFwd).normalize();

  _bm4.makeBasis(_bRight, _bUp, _bFwd);
  return outQuat.setFromRotationMatrix(_bm4);
}

function newSmoothState() {
  return {
    position: new THREE.Vector3(),
    scale: 1,
    quaternion: new THREE.Quaternion(),
    initialized: false,
  };
}

export class Engine3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = 1;
    this.height = 1;

    // Source video pixel size — needed to undo `object-fit: cover`.
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.dispW = 1;
    this.dispH = 1;
    this.offX = 0;
    this.offY = 0;

    // The camera feed is shown mirrored (selfie view), so landmarks get
    // flipped here. The canvas itself must NOT be CSS-mirrored as well.
    this.mirror = true;

    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 1, 20000);
    this.camera.position.z = 5000;

    this.ambient = new THREE.AmbientLight(0xffffff, 0.9);
    this.keyLight = new THREE.DirectionalLight(0xfff5e6, 1.0);
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    this.scene.add(this.ambient, this.keyLight, this.fillLight);

    this.modelCache = new Map();
    this.pendingLoads = new Map();
    this.activeItems = new Map();
  }

  /* ── Viewport ───────────────────────────────────────────────── */

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);

    const hw = this.width / 2;
    const hh = this.height / 2;
    this.camera.left = -hw;
    this.camera.right = hw;
    this.camera.top = hh;
    this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();

    this.keyLight.position.set(hw * 0.3, hh * 0.5, 2000);
    this.fillLight.position.set(-hw * 0.4, -hh * 0.2, 1500);

    this._updateCoverMapping();
  }

  setVideoSize(vw, vh) {
    if (!vw || !vh) return;
    this.videoWidth = vw;
    this.videoHeight = vh;
    this._updateCoverMapping();
  }

  /**
   * The <video> is drawn with `object-fit: cover`, so a 16:9 camera inside a
   * 3:4 box is cropped on the left and right. Landmarks are normalised to the
   * FULL video frame, so they must be mapped through the same cover transform
   * or the jewellery drifts sideways and moves at the wrong rate.
   */
  _updateCoverMapping() {
    const vw = this.videoWidth || this.width;
    const vh = this.videoHeight || this.height;
    const cover = Math.max(this.width / vw, this.height / vh);
    this.dispW = vw * cover;
    this.dispH = vh * cover;
    this.offX = (this.width - this.dispW) / 2;
    this.offY = (this.height - this.dispH) / 2;
  }

  /** Normalised landmark → centred screen-space point. Always writes to `out`. */
  lmToScreen(lm, out) {
    const nx = this.mirror ? 1 - lm.x : lm.x;
    const px = this.offX + nx * this.dispW;
    const py = this.offY + lm.y * this.dispH;
    return out.set(
      px - this.width / 2,
      -(py - this.height / 2),
      -(lm.z || 0) * this.dispW,
    );
  }

  /** Distance between two landmarks in on-screen pixels. */
  dist2D(a, b) {
    const dx = (a.x - b.x) * this.dispW;
    const dy = (a.y - b.y) * this.dispH;
    return Math.hypot(dx, dy);
  }

  /* ── Loading ────────────────────────────────────────────────── */

  async loadJewellery(id, folder, objFile, category, onProgress) {
    const cacheKey = `${folder}/${objFile}`;
    if (this.modelCache.has(cacheKey)) return this.modelCache.get(cacheKey);
    if (this.pendingLoads.has(cacheKey)) return this.pendingLoads.get(cacheKey);

    const job = this._loadTemplate(folder, objFile, category, cacheKey, onProgress)
      .then((template) => {
        this.modelCache.set(cacheKey, template);
        this.pendingLoads.delete(cacheKey);
        return template;
      })
      .catch((err) => {
        this.pendingLoads.delete(cacheKey);
        throw err;
      });

    this.pendingLoads.set(cacheKey, job);
    return job;
  }

  async _loadTemplate(folder, objFile, category, cacheKey, onProgress) {
    const basePath = `objects/${folder}/`;

    // Fetch the OBJ once, with progress — these files can be tens of MB and
    // a silent 30-second parse looks exactly like a crash.
    const raw = await fetchTextWithProgress(`${basePath}${objFile}`, onProgress);
    const objText = sanitizeObjText(raw, cacheKey);

    // Every loader is a fresh instance. The old code shared one loader and
    // mutated setPath()/setMaterials() on it, so two concurrent loads
    // corrupted each other's base path and material set.
    const objLoader = new OBJLoader();
    const materials = await this._loadMaterials(basePath, objFile, objText);
    if (materials) objLoader.setMaterials(materials);

    const object = objLoader.parse(objText);

    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (!materials) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xd4af37,
          metalness: 0.85,
          roughness: 0.25,
        });
      }
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      // Lots of exported OBJs have inconsistent face winding, which makes
      // half the model vanish under backface culling.
      mats.forEach((m) => { m.side = THREE.DoubleSide; });
      if (child.geometry) {
        scrubNaNVertices(child.geometry, cacheKey);
        if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
      }
    });

    const tuning = {
      ...CATEGORY_DEFAULTS[category],
      ...(MODEL_TUNING[folder] || {}),
    };

    const analysis = normalizeModel(object, category, tuning);

    const anchorOffset = new THREE.Vector3(
      tuning.offsetX || 0,
      (tuning.anchor === 'top' ? -analysis.normHeight / 2 : 0) + (tuning.offsetY || 0),
      tuning.offsetZ || 0,
    );

    console.log('[Engine3D] loaded', cacheKey, {
      rawSize: analysis.rawSize.toArray().map((n) => +n.toFixed(3)),
      normSize: analysis.normSize.toArray().map((n) => +n.toFixed(3)),
      fitAxis: tuning.fitAxis,
      anchor: tuning.anchor,
    });

    return { object, analysis, category, cacheKey, folder, tuning, anchorOffset };
  }

  async _loadMaterials(basePath, objFile, objText) {
    const names = [];
    const declared = objText.match(/^\s*mtllib\s+(.+)$/m);
    if (declared) names.push(declared[1].trim());
    names.push('model.mtl', objFile.replace(/\.obj$/i, '.mtl'));

    for (const name of [...new Set(names)]) {
      try {
        const res = await fetch(`${basePath}${name}`);
        if (!res.ok) continue;
        const text = await res.text();
        const loader = new MTLLoader();
        loader.setResourcePath(basePath);
        loader.setPath(basePath);
        const mtl = loader.parse(text, basePath);
        mtl.preload();
        return mtl;
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  }

  /* ── Activation ─────────────────────────────────────────────── */

  activate(id, template) {
    if (this.activeItems.has(id)) return;

    // Earrings and bracelets are worn as a pair, so one uploaded model gets
    // duplicated: instance 0 = left side, instance 1 = right side.
    const count = template.tuning.pair === 2 ? 2 : 1;
    const instances = [];

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      const pivot = new THREE.Group();
      const mesh = cloneWithOwnMaterials(template.object);

      pivot.position.copy(template.anchorOffset);
      // The mesh is centred on the pivot's origin, so flipping the pivot
      // mirrors the model about its own centre. Three.js reverses the
      // winding order for negative-determinant matrices, so lighting and
      // face culling stay correct.
      if (i === 1 && template.tuning.pairMirror) pivot.scale.x = -1;
      pivot.add(mesh);
      group.add(pivot);
      group.visible = false;
      this.scene.add(group);

      const materials = collectMaterials(mesh);
      materials.forEach((m) => {
        m.userData._baseOpacity = m.opacity;
        m.userData._baseTransparent = m.transparent;
      });

      instances.push({
        group,
        pivot,
        mesh,
        materials,
        opacity: -1, // force the first setOpacity through
        state: newSmoothState(),
      });
      this._setOpacity(instances[i], 0);
    }

    this.activeItems.set(id, {
      id,
      category: template.category,
      analysis: template.analysis,
      tuning: template.tuning,
      cacheKey: template.cacheKey,
      instances,
    });
  }

  deactivate(id) {
    const entry = this.activeItems.get(id);
    if (!entry) return;
    for (const inst of entry.instances) {
      this.scene.remove(inst.group);
      inst.materials.forEach((m) => m.dispose());
    }
    this.activeItems.delete(id);
  }

  clearScene() {
    for (const id of [...this.activeItems.keys()]) this.deactivate(id);
  }

  _setOpacity(inst, opacity) {
    if (Math.abs(inst.opacity - opacity) < 0.002) return;
    inst.opacity = opacity;
    const fullyIn = opacity >= 0.999;
    for (const m of inst.materials) {
      m.opacity = (m.userData._baseOpacity ?? 1) * opacity;
      // Once fully faded in, drop back to opaque rendering so the metal
      // doesn't stay see-through. Materials that were authored transparent
      // (e.g. gemstones with `d 0.7`) keep their transparency.
      m.transparent = !fullyIn || m.userData._baseTransparent === true;
      m.depthWrite = opacity > 0.6;
    }
  }

  /** Snap everything out of view immediately (used when the camera stops). */
  hideAll() {
    for (const [, entry] of this.activeItems) {
      for (const inst of entry.instances) {
        inst.group.visible = false;
        inst.state.initialized = false;
        this._setOpacity(inst, 0);
      }
    }
  }

  /** Smooth-follow + fade for one instance. */
  place(inst, targetPos, targetScale, targetQuat, visible) {
    const s = inst.state;

    if (visible) {
      if (!s.initialized) {
        s.position.copy(targetPos);
        s.scale = targetScale;
        s.quaternion.copy(targetQuat);
        s.initialized = true;
      } else {
        s.position.lerp(targetPos, SMOOTH);
        s.scale += (targetScale - s.scale) * SMOOTH;
        s.quaternion.slerp(targetQuat, SMOOTH);
      }
    }

    const target = visible ? 1 : 0;
    const next = inst.opacity + (target - inst.opacity) * FADE_SPEED;
    const clamped = Math.abs(target - next) < 0.01 ? target : next;

    inst.group.visible = clamped > 0.02;
    this._setOpacity(inst, clamped);

    // Fully hidden → forget the last pose so it snaps back in cleanly
    // instead of sliding across the screen when tracking returns.
    if (!visible && clamped <= 0.02) s.initialized = false;

    if (inst.group.visible) {
      inst.group.position.copy(s.position);
      inst.group.scale.setScalar(s.scale);
      inst.group.quaternion.copy(s.quaternion);
    }
  }

  hide(entry) {
    for (const inst of entry.instances) {
      this.place(inst, _pos, 1, _q1.identity(), false);
    }
  }

  /* ── Per-category placement ─────────────────────────────────── */

  updateNecklace(entry, tracking) {
    const face = tracking.face;
    if (!face || face.length < 468) return false;

    const leftJaw = face[FACE.leftJaw];
    const rightJaw = face[FACE.rightJaw];
    const chin = face[FACE.chin];
    const forehead = face[FACE.forehead];
    const pose = tracking.pose;
    const hasShoulders = pose && pose.length > POSE.rightShoulder
      && (pose[POSE.leftShoulder]?.visibility ?? 1) > 0.4
      && (pose[POSE.rightShoulder]?.visibility ?? 1) > 0.4;

    const jawWidth = this.dist2D(leftJaw, rightJaw);

    // Anchor: just below the chin, biased toward the shoulder line when
    // the torso is visible.
    let anchor;
    if (hasShoulders) {
      const lS = pose[POSE.leftShoulder];
      const rS = pose[POSE.rightShoulder];
      anchor = {
        x: chin.x * 0.4 + ((lS.x + rS.x) / 2) * 0.6,
        y: chin.y * 0.45 + ((lS.y + rS.y) / 2) * 0.55,
        z: (chin.z || 0) * 0.5 + (((lS.z || 0) + (rS.z || 0)) / 2) * 0.5,
      };
    } else {
      anchor = {
        x: (leftJaw.x + rightJaw.x) / 2,
        y: chin.y + (chin.y - forehead.y) * 0.18,
        z: ((leftJaw.z || 0) + (rightJaw.z || 0)) / 2,
      };
    }

    // Fit axis for a necklace is its WIDTH.
    let targetWidth = jawWidth * 1.55;
    if (hasShoulders) {
      const shoulderWidth = this.dist2D(pose[POSE.leftShoulder], pose[POSE.rightShoulder]);
      targetWidth = Math.max(targetWidth, shoulderWidth * 0.72);
    }
    const scale = targetWidth * (entry.tuning.scale ?? 1);

    this.lmToScreen(anchor, _pos);
    this.lmToScreen(leftJaw, _v1);
    this.lmToScreen(rightJaw, _v2);
    this.lmToScreen(forehead, _v3);
    this.lmToScreen(chin, _v4);

    const right = _v5.subVectors(_v2, _v1);       // head roll
    const up = _v6.subVectors(_v3, _v4);          // head up axis
    basisQuat(up, right, _q1);

    this.place(entry.instances[0], _pos, scale, _q1, true);
    return true;
  }

  updateEarrings(entry, tracking) {
    const face = tracking.face;
    if (!face || face.length < 468) return false;

    const leftJaw = face[FACE.leftJaw];
    const rightJaw = face[FACE.rightJaw];
    const chin = face[FACE.chin];
    const forehead = face[FACE.forehead];

    const faceHeight = this.dist2D(forehead, chin);

    // Fit axis for an earring is its DROP LENGTH.
    const scale = faceHeight * 0.16 * (entry.tuning.scale ?? 1);

    this.lmToScreen(leftJaw, _v1);
    this.lmToScreen(rightJaw, _v2);
    this.lmToScreen(forehead, _v3);
    this.lmToScreen(chin, _v4);

    const right = _v5.subVectors(_v2, _v1);
    const up = _v6.subVectors(_v3, _v4);
    basisQuat(up, right, _q1);

    // Earlobes: the jaw points, nudged down along the head's own up axis.
    const drop = _v6.clone().normalize().multiplyScalar(-faceHeight * 0.10);

    this.lmToScreen(face[FACE.leftLobe], _pos).add(drop);
    this.place(entry.instances[0], _pos, scale, _q1, true);

    // Second copy of the same uploaded model, on the other ear.
    if (entry.instances[1]) {
      this.lmToScreen(face[FACE.rightLobe], _pos).add(drop);
      this.place(entry.instances[1], _pos, scale, _q1, true);
    }
    return true;
  }

  updateRing(entry, tracking) {
    const hand = tracking.primaryHand;
    if (!hand || hand.length < 21) return false;

    const mcp = hand[HAND.ringMcp];
    const pip = hand[HAND.ringPip];
    const indexMcp = hand[HAND.indexMcp];
    const middleMcp = hand[HAND.middleMcp];
    const pinkyMcp = hand[HAND.pinkyMcp];

    // Sit on the base segment of the ring finger.
    const seat = {
      x: mcp.x + (pip.x - mcp.x) * 0.42,
      y: mcp.y + (pip.y - mcp.y) * 0.42,
      z: (mcp.z || 0) + ((pip.z || 0) - (mcp.z || 0)) * 0.42,
    };

    // Fit axis for a ring is its OUTER DIAMETER. One inter-knuckle gap is
    // a good stand-in for finger width.
    const fingerWidth = this.dist2D(middleMcp, mcp);
    const scale = Math.max(fingerWidth * 1.25, 8) * (entry.tuning.scale ?? 1);

    this.lmToScreen(seat, _pos);
    this.lmToScreen(mcp, _v1);
    this.lmToScreen(pip, _v2);
    this.lmToScreen(indexMcp, _v3);
    this.lmToScreen(pinkyMcp, _v4);

    // The finger runs through the ring's hole → that is the model's +Y.
    // Use the knuckle→joint segment the ring actually sits on, not the
    // fingertip, so a bent finger doesn't tip the ring over.
    const up = _v5.subVectors(_v2, _v1);
    const across = _v6.subVectors(_v4, _v3);
    basisQuat(up, across, _q1);

    this.place(entry.instances[0], _pos, scale, _q1, true);
    return true;
  }

  /**
   * A bracelet is worn as a pair, so instance 0 follows one hand and
   * instance 1 the other. The slots are keyed off MediaPipe's handedness
   * label, which keeps each copy locked to the same physical wrist instead
   * of swapping (and sliding across the screen) between frames.
   */
  updateBracelet(entry, tracking) {
    const hands = [tracking.leftHand, tracking.rightHand];
    let placed = 0;

    for (let i = 0; i < entry.instances.length; i++) {
      const hand = hands[i];
      if (!hand || hand.length < 21) {
        this.place(entry.instances[i], _pos, 1, _q1.identity(), false);
        continue;
      }
      this._placeBracelet(entry, entry.instances[i], hand);
      placed++;
    }

    // Single-instance fallback: if this model isn't set up as a pair, put it
    // on whichever hand is in view.
    if (!placed && entry.instances.length === 1) {
      const hand = tracking.primaryHand;
      if (!hand || hand.length < 21) return false;
      this._placeBracelet(entry, entry.instances[0], hand);
      placed++;
    }
    return placed > 0;
  }

  _placeBracelet(entry, inst, hand) {
    const wrist = hand[HAND.wrist];
    const middleMcp = hand[HAND.middleMcp];
    const indexMcp = hand[HAND.indexMcp];
    const pinkyMcp = hand[HAND.pinkyMcp];

    const wristWidth = this.dist2D(indexMcp, pinkyMcp);
    const scale = Math.max(wristWidth * 1.35, 12) * (entry.tuning.scale ?? 1);

    this.lmToScreen(wrist, _v1);
    this.lmToScreen(middleMcp, _v2);
    this.lmToScreen(indexMcp, _v3);
    this.lmToScreen(pinkyMcp, _v4);

    // Forearm runs through the bracelet's hole → model's +Y.
    const up = _v5.subVectors(_v2, _v1);
    const across = _v6.subVectors(_v4, _v3);

    // Slide down past the wrist crease, away from the palm.
    _pos.copy(_v1).addScaledVector(_v5.clone().normalize(), -wristWidth * 0.30);
    basisQuat(up, across, _q1);

    this.place(inst, _pos, scale, _q1, true);
  }

  /* ── Frame update ───────────────────────────────────────────── */

  update(tracking) {
    // A null tracking result means "nothing detected" — items fade out
    // rather than freezing wherever they last were.
    if (!tracking) tracking = {};

    for (const [, entry] of this.activeItems) {
      let ok = false;
      try {
        if (entry.category === 'necklace') ok = this.updateNecklace(entry, tracking);
        else if (entry.category === 'earring') ok = this.updateEarrings(entry, tracking);
        else if (entry.category === 'ring') ok = this.updateRing(entry, tracking);
        else if (entry.category === 'bracelet') ok = this.updateBracelet(entry, tracking);
      } catch (err) {
        console.warn('[Engine3D] update failed for', entry.id, err);
        ok = false;
      }
      if (!ok) this.hide(entry);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Which trackers actually need to run this frame, and how many hands. */
  requiredTrackers() {
    let face = false;
    let hands = false;
    let handCount = 1;
    for (const [, entry] of this.activeItems) {
      if (entry.category === 'necklace' || entry.category === 'earring') face = true;
      if (entry.category === 'ring' || entry.category === 'bracelet') hands = true;
      // A paired bracelet needs both wrists detected.
      if (entry.category === 'bracelet' && entry.instances.length === 2) handCount = 2;
    }
    return { face, hands, pose: face, handCount };
  }

  screenshot(video) {
    const w = this.width;
    const h = this.height;
    const composite = document.createElement('canvas');
    composite.width = w;
    composite.height = h;
    const ctx = composite.getContext('2d');

    // Draw the video with the same mirror + cover crop the page uses,
    // so the saved image matches what is on screen.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, this.offX, this.offY, this.dispW, this.dispH);
    ctx.restore();

    ctx.drawImage(this.canvas, 0, 0, w, h);
    return composite.toDataURL('image/png');
  }

  /* ── Live tuning (used by the ?tune=1 panel) ────────────────── */

  getTuning(id) {
    return this.activeItems.get(id)?.tuning ?? null;
  }

  /**
   * `scale`, `offset*` and `anchor` apply instantly.
   * `rot*` and `autoOrient` change how the model is baked, so they re-run
   * normalisation and rebuild the instances (geometry is shared, so this is
   * cheap even for a 300k-vertex model).
   */
  updateTuning(id, patch) {
    const entry = this.activeItems.get(id);
    if (!entry) return null;

    const template = this.modelCache.get(entry.cacheKey);
    if (!template) return null;

    Object.assign(template.tuning, patch);
    MODEL_TUNING[template.folder] = {
      ...(MODEL_TUNING[template.folder] || {}),
      ...patch,
    };

    const needsRebake = ['rotX', 'rotY', 'rotZ', 'autoOrient', 'fitAxis', 'pair', 'pairMirror']
      .some((k) => k in patch);

    if (needsRebake) {
      template.analysis = normalizeModel(template.object, template.category, template.tuning);
    }

    const t = template.tuning;
    template.anchorOffset.set(
      t.offsetX || 0,
      (t.anchor === 'top' ? -template.analysis.normHeight / 2 : 0) + (t.offsetY || 0),
      t.offsetZ || 0,
    );

    if (needsRebake) {
      this.deactivate(id);
      this.activate(id, template);
    } else {
      entry.tuning = t;
      entry.analysis = template.analysis;
      for (const inst of entry.instances) inst.pivot.position.copy(template.anchorOffset);
    }
    return t;
  }
}

/* ────────────────────────────────────────────────────────────────
   Model normalisation
   ──────────────────────────────────────────────────────────────── */

/**
 * Orients the model, centres it, and rescales it so the category's fit axis
 * measures exactly 1 unit. After this, runtime scaling is simply
 * `group.scale = targetPixels` — no magic clamps, no unit guessing.
 *
 * Order matters: rotation is applied FIRST and the centre is measured
 * afterwards. Centring before rotating leaves the model orbiting its own
 * origin, which is what pushed the necklace ~150px off the neck.
 */
function normalizeModel(object, category, tuning) {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);

  const rawBox = new THREE.Box3().setFromObject(object);
  const rawSize = rawBox.getSize(new THREE.Vector3());

  if (tuning.autoOrient !== false) {
    applyCanonicalRotation(object, rawSize, category);
  }
  object.rotation.x += (tuning.rotX || 0) * DEG;
  object.rotation.y += (tuning.rotY || 0) * DEG;
  object.rotation.z += (tuning.rotZ || 0) * DEG;
  object.updateMatrixWorld(true);

  // Measure AFTER rotating.
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const fit = tuning.fitAxis === 'y' ? size.y : tuning.fitAxis === 'z' ? size.z : size.x;
  const norm = 1 / Math.max(fit, 1e-6);

  // matrix = T · R · S, so a geometry point maps to `position + R·(s·p)`.
  // The rotated centre must therefore be cancelled *after* scaling.
  object.scale.setScalar(norm);
  object.position.copy(center).multiplyScalar(-norm);
  object.updateMatrixWorld(true);

  const normSize = size.clone().multiplyScalar(norm);

  return {
    rawSize,
    normSize,
    normWidth: normSize.x,
    normHeight: normSize.y,
    normDepth: normSize.z,
  };
}

/**
 * Bounding-box guess at how the model is laid out in its source file.
 *
 * Rings + bracelets: the limb passes through the hole, and the hole axis is
 * the model's thinnest direction → map it to +Y.
 * Necklaces + earrings: the piece is flat, so its thinnest direction is the
 * face normal → map it to +Z (toward the camera).
 */
function applyCanonicalRotation(object, size, category) {
  const dims = [size.x, size.y, size.z];
  const thin = dims.indexOf(Math.min(...dims));

  if (category === 'ring' || category === 'bracelet') {
    // thin axis → +Y
    if (thin === 0) object.rotation.z = Math.PI / 2;
    else if (thin === 2) object.rotation.x = -Math.PI / 2;
    // thin === 1 is already correct
  } else {
    // thin axis → +Z
    if (thin === 0) object.rotation.y = Math.PI / 2;
    else if (thin === 1) object.rotation.x = Math.PI / 2;
    // thin === 2 is already correct
  }
  object.updateMatrixWorld(true);
}

/**
 * Rhino (and a few other exporters) wrap long lines with a trailing backslash:
 *
 *     v -0.00066 -0.00133 \
 *      -11.43599
 *
 * Three's OBJLoader has no idea what that means — it reads "\" as the Z
 * coordinate, gets NaN, and one NaN vertex is enough to turn the whole
 * bounding box into NaN, at which point the model silently renders nothing.
 * Joining the continuations back up fixes it before parsing.
 */
function sanitizeObjText(text, label) {
  let out = text;
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1); // strip BOM

  if (out.includes('\\')) {
    const before = out.length;
    out = out.replace(/\\[ \t]*\r?\n[ \t]*/g, ' ');
    if (out.length !== before) {
      console.log(`[Engine3D] ${label}: joined backslash-continued lines`);
    }
  }
  return out;
}

/**
 * Last line of defence: a single NaN in the position buffer makes Box3 return
 * NaN, which makes the model invisible with no error anywhere. Zero them out
 * and say so loudly instead of failing silently.
 */
function scrubNaNVertices(geometry, label) {
  const pos = geometry.attributes.position;
  if (!pos) return;
  const arr = pos.array;
  let bad = 0;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) { arr[i] = 0; bad++; }
  }
  if (bad) {
    pos.needsUpdate = true;
    console.warn(
      `[Engine3D] ${label}: ${bad} invalid vertex value(s) were zeroed. ` +
      'The OBJ file is malformed — re-export it if the model looks wrong.',
    );
  }
}

function cloneWithOwnMaterials(source) {
  const copy = source.clone(true);
  copy.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((m) => m.clone())
      : child.material.clone();
  });
  return copy;
}

function collectMaterials(root) {
  const out = new Set();
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => out.add(m));
  });
  return [...out];
}

async function fetchTextWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);

  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || typeof onProgress !== 'function') {
    return res.text();
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }

  const merged = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(merged);
}

/* ────────────────────────────────────────────────────────────────
   Catalogue
   ──────────────────────────────────────────────────────────────── */

const OBJ_CANDIDATES = ['model.obj', 'scene.obj', '1.obj', '2.obj', '3.obj'];

export async function resolveObjFile(folder) {
  for (const name of [...OBJ_CANDIDATES, `${folder}.obj`]) {
    try {
      const res = await fetch(`objects/${folder}/${name}`, { method: 'HEAD' });
      if (res.ok) return name;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export async function probeFolder(folder) {
  const objFile = await resolveObjFile(folder);
  return objFile ? { folder, objFile, available: true } : { folder, available: false };
}

/* Add a folder here after dropping a model.obj into objects/<folder>/ */
export const FOLDER_CATALOG = [
  'necklace-gold', 'necklace-diamond', 'necklace-mala',
  'earring-gold', 'earring-diamond', 'earring-hoop',
  'ring-band', 'ring-solitaire',
  'bracelet-gold', 'bracelet-diamond',
];

export function folderToCategory(folder) {
  if (folder.startsWith('necklace-')) return 'necklace';
  if (folder.startsWith('earring-')) return 'earring';
  if (folder.startsWith('ring-')) return 'ring';
  if (folder.startsWith('bracelet-')) return 'bracelet';
  return null;
}

export function folderToLabel(folder) {
  const parts = folder.split('-');
  const type = parts[0];
  const variant = parts.slice(1).join(' ');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${cap(variant)} ${cap(type)}${type === 'earring' ? 's' : ''}`;
}
