/**
 * Three.js 3D Engine – Model loading, auto-calibration & jewellery placement
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import {
  Vec3Filter,
  EulerFilter,
  OneEuroFilter,
  REFERENCE_FACE_WIDTH,
  getCalibration,
  computeNeckAnchor,
  computeFaceWidth,
  computeHeadRotation,
} from './ar-tracking.js';

const NECKLACE_BASE_ROTATION = { x: -0.15, y: Math.PI, z: 0 };

const DEFAULT_GOLD = new THREE.MeshStandardMaterial({
  color: 0xc9a962,
  metalness: 0.85,
  roughness: 0.25,
  envMapIntensity: 1.2,
});

const DEFAULT_SILVER = new THREE.MeshStandardMaterial({
  color: 0xd4d4d4,
  metalness: 0.9,
  roughness: 0.15,
  envMapIntensity: 1.0,
});

const DEFAULT_DIAMOND = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0.1,
  roughness: 0.05,
  transmission: 0.6,
  thickness: 0.5,
  ior: 2.4,
  clearcoat: 1.0,
  clearcoatRoughness: 0.1,
});

export class Engine3D {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.jewelleryInstances = new Map();
    this.modelCache = new Map();
    this.clock = new THREE.Clock();
    this.trackingData = null;
    this.isInitialized = false;
    this.cameraActive = false;

    this._tempVec = new THREE.Vector3();
    this._tempVec2 = new THREE.Vector3();
    this._tempDir = new THREE.Vector3();
    this._tempNdc = new THREE.Vector3();
    this._tempEuler = new THREE.Euler();
    this._tempOffset = new THREE.Vector3();
  }

  init() {
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 480;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(63, w / h, 0.01, 100);
    this.camera.position.set(0, 0, 5);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    keyLight.position.set(2, 3, 4);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe6eeff, 0.5);
    fillLight.position.set(-2, 1, 2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xc9a962, 0.4);
    rimLight.position.set(0, -1, -3);
    this.scene.add(rimLight);

    this.isInitialized = true;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  async loadModel(id, folderPath, category) {
    const exists = await this.verifyModelFile(folderPath);
    if (!exists) {
      throw new Error(`model.obj not found in ${folderPath}`);
    }

    if (this.modelCache.has(id)) {
      return this.modelCache.get(id).clone(true);
    }

    const basePath = `${folderPath}/`;
    const objPath = `${basePath}model.obj`;
    const mtlPath = `${basePath}model.mtl`;

    let group;
    const mtlExists = await this._fileExists(mtlPath);

    if (mtlExists) {
      group = await this._loadWithMTL(mtlPath, objPath, basePath);
    } else {
      group = await this._loadOBJOnly(objPath, category);
    }

    if (!this._modelHasMeshes(group)) {
      throw new Error(`model.obj has no meshes: ${folderPath}`);
    }

    this._autoCalibrate(group, category);
    this.modelCache.set(id, group);
    return group.clone(true);
  }

  _modelHasMeshes(group) {
    let count = 0;
    group.traverse((child) => {
      if (child.isMesh) count += 1;
    });
    return count > 0;
  }

  async _fileExists(url) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  }

  _loadWithMTL(mtlPath, objPath, basePath) {
    return new Promise((resolve, reject) => {
      const mtlLoader = new MTLLoader();
      mtlLoader.setPath(basePath);
      mtlLoader.load(
        'model.mtl',
        (materials) => {
          materials.preload();
          const objLoader = new OBJLoader();
          objLoader.setMaterials(materials);
          objLoader.setPath(basePath);
          objLoader.load(
            'model.obj',
            (obj) => resolve(this._wrapModel(obj)),
            undefined,
            reject
          );
        },
        undefined,
        () => {
          this._loadOBJOnly(objPath, 'default').then(resolve).catch(reject);
        }
      );
    });
  }

  _loadOBJOnly(objPath, category) {
    return new Promise((resolve, reject) => {
      const loader = new OBJLoader();
      loader.load(
        objPath,
        (obj) => {
          const mat = this._getDefaultMaterial(category);
          obj.traverse((child) => {
            if (child.isMesh) {
              child.material = mat.clone();
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          resolve(this._wrapModel(obj));
        },
        undefined,
        reject
      );
    });
  }

  _getDefaultMaterial(category) {
    if (category.includes('diamond') || category.includes('solitaire')) {
      return DEFAULT_DIAMOND;
    }
    if (category.includes('silver')) {
      return DEFAULT_SILVER;
    }
    return DEFAULT_GOLD;
  }

  _wrapModel(obj) {
    const group = new THREE.Group();
    group.add(obj);
    return group;
  }

  _autoCalibrate(group, category) {
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    group.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const normScale = 1.0 / maxDim;
    group.scale.setScalar(normScale);

    group.userData.calibration = {
      originalSize: size.clone(),
      maxDim,
      baseNormScale: normScale,
      category,
    };

    this._applyCategoryOrientation(group, category, size);
  }

  _applyCategoryOrientation(group, category, size) {
    const type = category.split('-')[0];
    switch (type) {
      case 'earring':
        group.rotation.x = 0;
        group.rotation.y = 0;
        break;
      case 'necklace':
        group.rotation.x = -0.15;
        group.rotation.y = Math.PI;
        break;
      case 'ring':
        group.rotation.x = Math.PI / 2;
        break;
      case 'bracelet':
        group.rotation.x = Math.PI / 2;
        group.rotation.z = Math.PI / 2;
        break;
    }
  }

  activateJewellery(id, category, modelGroup) {
    if (this.jewelleryInstances.has(id)) {
      this.deactivateJewellery(id);
    }

    const type = category.split('-')[0];
    const instance = {
      id,
      category,
      type,
      model: modelGroup,
      visible: false,
      targetOpacity: 0,
      currentOpacity: 0,
      meshes: [],
      calibration: getCalibration(id),
      lastTransform: null,
      neckFilters: type === 'necklace' ? {
        position: new Vec3Filter(1.2, 0.012),
        rotation: new EulerFilter(0.85, 0.01),
        scale: new OneEuroFilter(0.75, 0.018),
      } : null,
    };

    modelGroup.traverse((child) => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0;
        child.material.depthWrite = true;
        child.material.depthTest = true;
        instance.meshes.push(child);
      }
    });

    if (type === 'earring') {
      instance.mirror = modelGroup.clone(true);
      instance.mirror.traverse((child) => {
        if (child.isMesh) {
          child.material = child.material.clone();
          child.material.transparent = true;
          child.material.opacity = 0;
          instance.meshes.push(child);
        }
      });
      instance.mirror.scale.x *= -1;
      this.scene.add(instance.mirror);
    }

    this.scene.add(modelGroup);
    this.jewelleryInstances.set(id, instance);
  }

  deactivateJewellery(id) {
    const instance = this.jewelleryInstances.get(id);
    if (!instance) return;

    this.scene.remove(instance.model);
    if (instance.mirror) this.scene.remove(instance.mirror);
    this.jewelleryInstances.delete(id);
  }

  setJewelleryVisible(id, visible) {
    const instance = this.jewelleryInstances.get(id);
    if (!instance) return;
    instance.visible = visible;
    instance.targetOpacity = visible ? 1 : 0;
    if (!visible && instance.type === 'necklace' && instance.neckFilters) {
      instance.neckFilters.position.reset();
      instance.neckFilters.rotation.reset();
      instance.neckFilters.scale.reset();
      instance.lastTransform = null;
    }
  }

  setCameraActive(active) {
    this.cameraActive = active;
    if (!active) {
      this.trackingData = null;
      this.hideAllJewellery();
    }
  }

  hideAllJewellery() {
    for (const [, instance] of this.jewelleryInstances) {
      instance.visible = false;
      instance.targetOpacity = 0;
      instance.currentOpacity = 0;
      instance.model.visible = false;
      if (instance.mirror) instance.mirror.visible = false;
      for (const mesh of instance.meshes) {
        mesh.material.opacity = 0;
      }
    }
  }

  invalidateModel(id) {
    this.modelCache.delete(id);
    if (this.jewelleryInstances.has(id)) {
      this.deactivateJewellery(id);
    }
  }

  async verifyModelFile(folderPath) {
    try {
      const res = await fetch(`${folderPath}/model.obj`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!res.ok) return false;

      const text = (await res.text()).trimStart().slice(0, 512);
      if (!text) return false;

      const lower = text.toLowerCase();
      if (lower.startsWith('<!doctype') || lower.startsWith('<html')) return false;

      return (
        text.startsWith('#') ||
        text.startsWith('v ') ||
        text.startsWith('o ') ||
        text.startsWith('g ') ||
        text.includes('\nv ') ||
        text.includes('\no ') ||
        text.includes('\ng ')
      );
    } catch {
      return false;
    }
  }

  updateTracking(trackingData) {
    this.trackingData = trackingData;
  }

  render() {
    if (!this.isInitialized) return;

    const dt = this.clock.getDelta();
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    this._updateJewelleryPlacement(w, h, dt);
    this.renderer.render(this.scene, this.camera);
  }

  _updateJewelleryPlacement(w, h, dt) {
    for (const [, instance] of this.jewelleryInstances) {
      this._animateOpacity(instance, dt);

      if (instance.targetOpacity < 0.01) {
        instance.model.visible = false;
        if (instance.mirror) instance.mirror.visible = false;
        continue;
      }

      instance.model.visible = true;
      if (instance.mirror) instance.mirror.visible = true;

      switch (instance.type) {
        case 'earring':
          this._placeEarrings(instance, w, h);
          break;
        case 'necklace':
          this._placeNecklace(instance, w, h);
          break;
        case 'ring':
          this._placeRing(instance, w, h);
          break;
        case 'bracelet':
          this._placeBracelet(instance, w, h);
          break;
      }
    }
  }

  _animateOpacity(instance, dt) {
    const speed = 6;
    const diff = instance.targetOpacity - instance.currentOpacity;
    instance.currentOpacity += diff * Math.min(1, speed * dt);

    for (const mesh of instance.meshes) {
      mesh.material.opacity = instance.currentOpacity;
    }
  }

  _landmarkToWorld(lm, faceWidth, w, h) {
    const vw = this.video.videoWidth || w;
    const vh = this.video.videoHeight || h;

    let nx = 1.0 - lm.x;
    let ny = lm.y;

    if (vw > 0 && vh > 0 && w > 0 && h > 0) {
      const videoAspect = vw / vh;
      const canvasAspect = w / h;
      if (videoAspect > canvasAspect) {
        const scale = videoAspect / canvasAspect;
        nx = (nx - 0.5) * scale + 0.5;
      } else if (canvasAspect > videoAspect) {
        const scale = canvasAspect / videoAspect;
        ny = (ny - 0.5) * scale + 0.5;
      }
    }

    const ndcX = nx * 2.0 - 1.0;
    const ndcY = -ny * 2.0 + 1.0;
    const depth = this._estimateWorldDepth(faceWidth, lm.z);

    this._tempNdc.set(ndcX, ndcY, 0.5);
    this._tempNdc.unproject(this.camera);
    this._tempDir.copy(this._tempNdc).sub(this.camera.position).normalize();

    if (Math.abs(this._tempDir.z) < 0.001) {
      this._tempDir.z = -0.001;
    }

    const t = (depth - this.camera.position.z) / this._tempDir.z;
    if (!Number.isFinite(t)) {
      return this._tempVec.set(0, 0, depth);
    }

    return this._tempVec
      .copy(this.camera.position)
      .add(this._tempDir.multiplyScalar(t));
  }

  _estimateWorldDepth(faceWidth, landmarkZ = 0) {
    const ratio = REFERENCE_FACE_WIDTH / Math.max(faceWidth, 0.06);
    return Math.max(1.8, Math.min(3.8, 2.6 * ratio + landmarkZ * 0.35));
  }

  _placeEarrings(instance, w, h) {
    const face = this.trackingData?.face;
    if (!face) return;

    const faceWidth = computeFaceWidth(face);
    const earScale = faceWidth * w * 0.022;

    const leftLm = face.leftEarLobe;
    const rightLm = face.rightEarLobe;
    const headTilt = Math.atan2(
      face.rightEar.y - face.leftEar.y,
      face.rightEar.x - face.leftEar.x
    );

    const leftWorld = this._landmarkToWorld(leftLm, faceWidth, w, h);
    const rightWorld = this._landmarkToWorld(rightLm, faceWidth, w, h);

    this._applyTransform(instance.model, leftWorld, earScale, {
      x: 0.1, y: headTilt + Math.PI / 2, z: 0.05,
    }, instance);

    if (instance.mirror) {
      this._applyTransform(instance.mirror, rightWorld, earScale, {
        x: 0.1, y: headTilt - Math.PI / 2, z: -0.05,
      }, instance, true);
    }
  }

  _placeNecklace(instance, w, h) {
    const face = this.trackingData?.face;
    const pose = this.trackingData?.pose;

    const FIXED_Z = 0;
    const FIXED_SCALE = 2.0;
    const baseNorm = instance.model.userData.calibration?.baseNormScale || 1;

    if (!face || !instance.neckFilters) {
      if (instance.lastTransform) {
        instance.model.visible = true;
        this._applyNecklaceTransform(instance, instance.lastTransform);
      }
      return;
    }

    const rawNeck = computeNeckAnchor(face, pose);
    if (!rawNeck) {
      if (instance.lastTransform) {
        instance.model.visible = true;
        this._applyNecklaceTransform(instance, instance.lastTransform);
      }
      return;
    }

    instance.model.visible = true;

    const filters = instance.neckFilters;
    const time = performance.now() / 1000;
    const neck = filters.position.filter(rawNeck, time);

    const x = (0.5 - neck.x) * w * 0.008;
    const y = -(neck.y - 0.5) * h * 0.008;

    const transform = {
      position: { x, y, z: FIXED_Z },
      scale: baseNorm * FIXED_SCALE,
      fadeScale: 0.85 + instance.currentOpacity * 0.15,
    };

    instance.lastTransform = transform;
    this._applyNecklaceTransform(instance, transform);
  }

  _applyNecklaceTransform(instance, transform) {
    const pos = transform.position;
    instance.model.position.set(pos.x, pos.y, pos.z);

    instance.model.rotation.set(
      NECKLACE_BASE_ROTATION.x,
      NECKLACE_BASE_ROTATION.y,
      NECKLACE_BASE_ROTATION.z
    );

    const fadeScale = transform.fadeScale ?? 1;
    instance.model.scale.setScalar(transform.scale * fadeScale);
  }

  _placeRing(instance, w, h) {
    const hands = this.trackingData?.hands;
    if (!hands?.length) return;

    const face = this.trackingData?.face;
    const faceWidth = face ? computeFaceWidth(face) : REFERENCE_FACE_WIDTH;

    const hand = hands.reduce((best, hd) =>
      hd.fingerLength > (best?.fingerLength || 0) ? hd : best
    , hands[0]);

    const pip = hand.ringPIP;
    const dip = hand.ringDIP;
    const mcp = hand.ringMCP;
    const tip = hand.ringTip;

    const ringLm = {
      x: (pip.x + dip.x) / 2,
      y: (pip.y + dip.y) / 2,
      z: (pip.z + dip.z) / 2,
    };

    const worldPos = this._landmarkToWorld(ringLm, faceWidth, w, h);
    const fingerAngle = Math.atan2(tip.y - mcp.y, tip.x - mcp.x);
    const fingerTilt = Math.atan2(
      tip.y - mcp.y,
      Math.hypot(tip.x - mcp.x, (tip.z - mcp.z) * 5) + 0.001
    );
    const ringScale = hand.fingerLength * w * 0.025;

    this._applyTransform(instance.model, worldPos, ringScale, {
      x: fingerTilt * 0.8,
      y: hand.ringPIP.z * 2,
      z: fingerAngle + Math.PI / 2,
    }, instance);
  }

  _placeBracelet(instance, w, h) {
    const hands = this.trackingData?.hands;
    if (!hands?.length) return;

    const face = this.trackingData?.face;
    const faceWidth = face ? computeFaceWidth(face) : REFERENCE_FACE_WIDTH;

    const hand = hands[0];
    const wrist = hand.wrist;
    const middleMCP = hand.middleMCP;

    const worldPos = this._landmarkToWorld(wrist, faceWidth, w, h);
    const wristAngle = Math.atan2(
      middleMCP.y - wrist.y,
      middleMCP.x - wrist.x
    );
    const wristTilt = Math.atan2(
      middleMCP.y - wrist.y,
      Math.hypot(middleMCP.x - wrist.x, (middleMCP.z - wrist.z) * 5) + 0.001
    );
    const braceletScale = hand.wristWidth * w * 0.055;

    this._applyTransform(instance.model, worldPos, braceletScale, {
      x: wristTilt * 0.5,
      y: wrist.z * 1.5,
      z: wristAngle + Math.PI / 2,
    }, instance);
  }

  _applyTransform(model, worldPos, scale, rotation, instance, mirrorX = false) {
    model.position.copy(worldPos);
    model.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    const baseNorm = model.userData.calibration?.baseNormScale || 1;
    const fadeScale = instance ? 0.85 + instance.currentOpacity * 0.15 : 1;
    const s = baseNorm * scale * fadeScale;
    model.scale.set(mirrorX ? -s : s, s, s);
  }

  captureScreenshot() {
    this.render();
    const tempCanvas = document.createElement('canvas');
    const vw = this.video.videoWidth || this.canvas.width;
    const vh = this.video.videoHeight || this.canvas.height;
    tempCanvas.width = vw;
    tempCanvas.height = vh;
    const ctx = tempCanvas.getContext('2d');

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, -vw, 0, vw, vh);
    ctx.restore();

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(this.canvas, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    return tempCanvas.toDataURL('image/png');
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer?.dispose();
    for (const [, instance] of this.jewelleryInstances) {
      this.deactivateJewellery(instance.id);
    }
    this.modelCache.clear();
  }
}
