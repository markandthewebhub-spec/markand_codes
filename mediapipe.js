/**
 * MediaPipe Tracking Module
 * Face Mesh, Hands, and Pose landmark detection
 */

export const FACE_LANDMARKS = {
  NOSE_TIP: 1,
  FOREHEAD: 10,
  CHIN: 152,
  LEFT_EAR: 234,
  LEFT_EAR_LOBE: 227,
  LEFT_JAW: 172,
  RIGHT_EAR: 454,
  RIGHT_EAR_LOBE: 447,
  RIGHT_JAW: 397,
  LEFT_CHEEK: 234,
  RIGHT_CHEEK: 454,
  LEFT_EYE_OUTER: 263,
  RIGHT_EYE_OUTER: 33,
  LEFT_TEMPLE: 162,
  RIGHT_TEMPLE: 389,
};

export const HAND_LANDMARKS = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
};

export const POSE_LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  NECK: 0,
};

export class MediaPipeTracker {
  constructor(videoElement) {
    this.video = videoElement;
    this.faceMesh = null;
    this.hands = null;
    this.pose = null;
    this.camera = null;
    this.isRunning = false;

    this.faceResults = null;
    this.handResults = null;
    this.poseResults = null;

    this.onResultsCallback = null;
  }

  async init() {
    this.faceMesh = new FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.faceMesh.onResults((results) => {
      this.faceResults = results;
    });

    this.hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.hands.onResults((results) => {
      this.handResults = results;
    });

    this.pose = new Pose({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });
    this.pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.pose.onResults((results) => {
      this.poseResults = results;
    });

    await Promise.all([
      this._waitForInit(this.faceMesh),
      this._waitForInit(this.hands),
      this._waitForInit(this.pose),
    ]);
  }

  _waitForInit(solution) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (solution && solution._graph) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 3000);
    });
  }

  async start() {
    if (this.isRunning) return;

    this.isRunning = true;

    this.camera = new Camera(this.video, {
      onFrame: async () => {
        if (!this.isRunning) return;
        try {
          await Promise.all([
            this.faceMesh.send({ image: this.video }),
            this.hands.send({ image: this.video }),
            this.pose.send({ image: this.video }),
          ]);
          if (this.onResultsCallback) {
            this.onResultsCallback(this.getTrackingData());
          }
        } catch (err) {
          console.error('MediaPipe frame error:', err);
        }
      },
      width: 1280,
      height: 720,
    });

    await this.camera.start();
  }

  stop() {
    this.isRunning = false;
    if (this.camera) {
      this.camera.stop();
      this.camera = null;
    }
    this.faceResults = null;
    this.handResults = null;
    this.poseResults = null;
  }

  onResults(callback) {
    this.onResultsCallback = callback;
  }

  getTrackingData() {
    return {
      face: this._parseFace(),
      hands: this._parseHands(),
      pose: this._parsePose(),
      hasFace: !!this.faceResults?.multiFaceLandmarks?.length,
      hasHands: !!this.handResults?.multiHandLandmarks?.length,
      hasPose: !!this.poseResults?.poseLandmarks,
    };
  }

  _parseFace() {
    if (!this.faceResults?.multiFaceLandmarks?.length) return null;
    const landmarks = this.faceResults.multiFaceLandmarks[0];
    const get = (idx) => ({
      x: landmarks[idx].x,
      y: landmarks[idx].y,
      z: landmarks[idx].z,
    });

    return {
      landmarks,
      nose: get(FACE_LANDMARKS.NOSE_TIP),
      chin: get(FACE_LANDMARKS.CHIN),
      forehead: get(FACE_LANDMARKS.FOREHEAD),
      leftEar: get(FACE_LANDMARKS.LEFT_EAR),
      rightEar: get(FACE_LANDMARKS.RIGHT_EAR),
      leftJaw: get(FACE_LANDMARKS.LEFT_JAW),
      rightJaw: get(FACE_LANDMARKS.RIGHT_JAW),
      leftEarLobe: get(FACE_LANDMARKS.LEFT_EAR_LOBE),
      rightEarLobe: get(FACE_LANDMARKS.RIGHT_EAR_LOBE),
      leftTemple: get(FACE_LANDMARKS.LEFT_TEMPLE),
      rightTemple: get(FACE_LANDMARKS.RIGHT_TEMPLE),
      leftEyeOuter: get(FACE_LANDMARKS.LEFT_EYE_OUTER),
      rightEyeOuter: get(FACE_LANDMARKS.RIGHT_EYE_OUTER),
      faceWidth: Math.hypot(
        landmarks[FACE_LANDMARKS.LEFT_JAW].x - landmarks[FACE_LANDMARKS.RIGHT_JAW].x,
        landmarks[FACE_LANDMARKS.LEFT_JAW].y - landmarks[FACE_LANDMARKS.RIGHT_JAW].y
      ),
      jawWidth: Math.hypot(
        landmarks[FACE_LANDMARKS.LEFT_JAW].x - landmarks[FACE_LANDMARKS.RIGHT_JAW].x,
        landmarks[FACE_LANDMARKS.LEFT_JAW].y - landmarks[FACE_LANDMARKS.RIGHT_JAW].y
      ),
    };
  }

  _parseHands() {
    if (!this.handResults?.multiHandLandmarks?.length) return [];
    const { multiHandLandmarks, multiHandedness } = this.handResults;

    return multiHandLandmarks.map((landmarks, i) => {
      const get = (idx) => ({
        x: landmarks[idx].x,
        y: landmarks[idx].y,
        z: landmarks[idx].z,
      });

      const label = multiHandedness?.[i]?.label || 'Unknown';

      return {
        landmarks,
        handedness: label,
        wrist: get(HAND_LANDMARKS.WRIST),
        ringMCP: get(HAND_LANDMARKS.RING_MCP),
        ringPIP: get(HAND_LANDMARKS.RING_PIP),
        ringDIP: get(HAND_LANDMARKS.RING_DIP),
        ringTip: get(HAND_LANDMARKS.RING_TIP),
        indexMCP: get(HAND_LANDMARKS.INDEX_MCP),
        middleMCP: get(HAND_LANDMARKS.MIDDLE_MCP),
        pinkyMCP: get(HAND_LANDMARKS.PINKY_MCP),
        fingerLength: Math.hypot(
          landmarks[HAND_LANDMARKS.RING_MCP].x - landmarks[HAND_LANDMARKS.RING_TIP].x,
          landmarks[HAND_LANDMARKS.RING_MCP].y - landmarks[HAND_LANDMARKS.RING_TIP].y
        ),
        wristWidth: Math.hypot(
          landmarks[HAND_LANDMARKS.INDEX_MCP].x - landmarks[HAND_LANDMARKS.PINKY_MCP].x,
          landmarks[HAND_LANDMARKS.INDEX_MCP].y - landmarks[HAND_LANDMARKS.PINKY_MCP].y
        ),
      };
    });
  }

  _parsePose() {
    if (!this.poseResults?.poseLandmarks) return null;
    const lm = this.poseResults.poseLandmarks;
    const get = (idx) => ({
      x: lm[idx].x,
      y: lm[idx].y,
      z: lm[idx].z,
      visibility: lm[idx].visibility ?? 1,
    });

    return {
      leftShoulder: get(POSE_LANDMARKS.LEFT_SHOULDER),
      rightShoulder: get(POSE_LANDMARKS.RIGHT_SHOULDER),
      leftWrist: get(POSE_LANDMARKS.LEFT_WRIST),
      rightWrist: get(POSE_LANDMARKS.RIGHT_WRIST),
      shoulderWidth: Math.hypot(
        lm[POSE_LANDMARKS.LEFT_SHOULDER].x - lm[POSE_LANDMARKS.RIGHT_SHOULDER].x,
        lm[POSE_LANDMARKS.LEFT_SHOULDER].y - lm[POSE_LANDMARKS.RIGHT_SHOULDER].y
      ),
    };
  }
}

export function landmarkToScreen(landmark, width, height) {
  return {
    x: (1 - landmark.x) * width,
    y: landmark.y * height,
    z: landmark.z,
  };
}

export function directionToEuler(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = (to.z || 0) - (from.z || 0);
  const yaw = Math.atan2(dx, dz || 0.001);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz || 0.001));
  return { x: pitch, y: yaw, z: 0 };
}
