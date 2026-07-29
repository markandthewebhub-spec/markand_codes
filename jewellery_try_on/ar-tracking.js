/**
 * AR Tracking Utilities – One Euro Filter, neck anchor, head rotation
 */

export class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(x, t) {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(t - this.tPrev, 0.001);
    const dx = (x - this.xPrev) / dt;
    const edx = this._lowPass(dx, this.dxPrev, this._alpha(dt, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const result = this._lowPass(x, this.xPrev, this._alpha(dt, cutoff));
    this.xPrev = result;
    this.dxPrev = edx;
    this.tPrev = t;
    return result;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  _alpha(dt, cutoff) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  _lowPass(a, b, alpha) {
    return alpha * a + (1 - alpha) * b;
  }
}

export class Vec3Filter {
  constructor(minCutoff = 1.2, beta = 0.008) {
    this.fx = new OneEuroFilter(minCutoff, beta);
    this.fy = new OneEuroFilter(minCutoff, beta);
    this.fz = new OneEuroFilter(minCutoff, beta);
  }

  filter(v, t) {
    return {
      x: this.fx.filter(v.x, t),
      y: this.fy.filter(v.y, t),
      z: this.fz.filter(v.z, t),
    };
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

export class EulerFilter {
  constructor(minCutoff = 1.0, beta = 0.006) {
    this.fx = new OneEuroFilter(minCutoff, beta);
    this.fy = new OneEuroFilter(minCutoff, beta);
    this.fz = new OneEuroFilter(minCutoff, beta);
  }

  filter(e, t) {
    return {
      x: this.fx.filter(e.x, t),
      y: this.fy.filter(e.y, t),
      z: this.fz.filter(e.z, t),
    };
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

export const REFERENCE_FACE_WIDTH = 0.22;

export const MODEL_CALIBRATION = {
  default: {
    baseScale: 1.0,
    positionOffsetX: 0,
    positionOffsetY: 0.015,
    positionOffsetZ: 0,
    rotationOffsetX: 0,
    rotationOffsetY: 0,
    rotationOffsetZ: 0,
    neckVerticalOffset: 0.045,
  },
  'necklace-gold': {
    baseScale: 1.15,
    positionOffsetX: 0,
    positionOffsetY: 0,
    positionOffsetZ: 0,
    rotationOffsetX: 0,
    rotationOffsetY: 0,
    rotationOffsetZ: 0,
    neckVerticalOffset: 0.055,
  },
  'necklace-diamond': {
    baseScale: 1.0,
    positionOffsetY: 0,
    rotationOffsetY: 0,
    neckVerticalOffset: 0.048,
  },
  'necklace-mala': {
    baseScale: 1.1,
    positionOffsetY: 0,
    rotationOffsetY: 0,
    neckVerticalOffset: 0.055,
  },
};

export function getCalibration(modelId) {
  return { ...MODEL_CALIBRATION.default, ...(MODEL_CALIBRATION[modelId] || {}) };
}

export function computeNeckAnchor(face, pose, verticalOffset = 0.045) {
  if (!face) return null;

  const pts = [];
  const weights = [];

  if (face.leftJaw) { pts.push(face.leftJaw); weights.push(1); }
  if (face.rightJaw) { pts.push(face.rightJaw); weights.push(1); }
  if (face.chin) { pts.push(face.chin); weights.push(1.2); }

  if (pose?.leftShoulder?.visibility > 0.45) {
    pts.push(pose.leftShoulder);
    weights.push(0.8);
  }
  if (pose?.rightShoulder?.visibility > 0.45) {
    pts.push(pose.rightShoulder);
    weights.push(0.8);
  }

  if (!pts.length) return null;

  let wx = 0, wy = 0, wz = 0, wt = 0;
  for (let i = 0; i < pts.length; i++) {
    const w = weights[i];
    wx += pts[i].x * w;
    wy += pts[i].y * w;
    wz += pts[i].z * w;
    wt += w;
  }

  return {
    x: wx / wt,
    y: wy / wt + verticalOffset,
    z: wz / wt,
  };
}

export function computeFaceWidth(face) {
  if (!face) return REFERENCE_FACE_WIDTH;

  if (face.leftJaw && face.rightJaw) {
    return Math.hypot(
      face.rightJaw.x - face.leftJaw.x,
      face.rightJaw.y - face.leftJaw.y
    );
  }

  return face.faceWidth || REFERENCE_FACE_WIDTH;
}

export function computeHeadRotation(face) {
  if (!face?.landmarks) return { x: 0, y: 0, z: 0 };

  const lm = face.landmarks;
  const le = lm[33];
  const re = lm[263];
  const chin = lm[152];
  const forehead = lm[10];

  const rx = re.x - le.x;
  const ry = re.y - le.y;
  const rz = re.z - le.z;
  const rLen = Math.hypot(rx, ry, rz) || 0.001;

  const ux = forehead.x - chin.x;
  const uy = forehead.y - chin.y;
  const uz = forehead.z - chin.z;
  const uLen = Math.hypot(ux, uy, uz) || 0.001;

  const rnx = rx / rLen, rny = ry / rLen, rnz = rz / rLen;
  const unx = ux / uLen, uny = uy / uLen, unz = uz / uLen;

  let fnx = rny * unz - rnz * uny;
  let fny = rnz * unx - rnx * unz;
  let fnz = rnx * uny - rny * unx;
  const fLen = Math.hypot(fnx, fny, fnz) || 0.001;
  fnx /= fLen; fny /= fLen; fnz /= fLen;

  const pitch = Math.asin(Math.max(-1, Math.min(1, -fny)));
  const yaw = Math.atan2(fnx, fnz);
  const roll = Math.atan2(rny, rnx);

  return { x: pitch, y: yaw, z: roll };
}

export function estimateDistanceFactor(faceWidth, neckZ = 0) {
  const widthFactor = REFERENCE_FACE_WIDTH / Math.max(faceWidth, 0.06);
  const depthFactor = 1.0 + neckZ * 2.5;
  return widthFactor * depthFactor;
}
