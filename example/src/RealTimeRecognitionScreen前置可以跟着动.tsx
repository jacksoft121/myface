import 'react-native-worklets-core';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';

import {
  BoxedInspireFace,
  CameraRotation,
  DetectMode,
  InspireFace,
} from 'react-native-nitro-inspire-face';
import { NitroModules } from 'react-native-nitro-modules';

import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
  runAtTargetFps,
  type Frame,
} from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';

import {
  check,
  request,
  openSettings,
  PERMISSIONS,
  RESULTS,
} from 'react-native-permissions';

import { Worklets } from 'react-native-worklets-core';
import { Canvas, Rect, Text as SkiaText, useFont } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';

import { type RegisteredFacesDTO, type FaceBoxBuf, type FaceBoxUI } from './dto/DlxTypes';
import { STORAGE_KEYS, userInfoCacheStorage } from './comm/GlobalStorage';
import { log } from './comm/logger';

// ===================== 镜像开关（只改这里） =====================
// 方案A：镜像预览 + 画框不镜像（推荐）
const MIRROR_ON_PREVIEW = true;
const MIRROR_ON_OVERLAY = !MIRROR_ON_PREVIEW;

// 极少数机型 SDK y 原点在左下角才需要（一般 false）
const SDK_Y_ORIGIN_BOTTOM = false;

// ===================== Launch once =====================
const gAny: any = globalThis as any;
if (!gAny.__IFACE_LAUNCHED) {
  InspireFace.launch('Pikachu');
  gAny.__IFACE_LAUNCHED = true;
}

// ===================== Const =====================
const { width: PREVIEW_W, height: PREVIEW_H } = Dimensions.get('window');

// ✅ 输入给 SDK 的稳定尺寸：永远 640x480
const SRC_W = 640;
const SRC_H = 480;

// Skia colors
const COLOR_GREEN = 0xff00ff00;
const COLOR_RED = 0xffff0000;
const BG_GREEN = 0xd900ff00;
const BG_RED = 0xd9ff0000;
const BG_BLACK50 = 0x80000000;
const COLOR_WHITE = 0xffffffff;
const COLOR_BLACK = 0xff000000;

// ===================== Permission =====================
function getCameraPermissionConst() {
  return Platform.select({
    ios: PERMISSIONS.IOS.CAMERA,
    android: PERMISSIONS.ANDROID.CAMERA,
    default: PERMISSIONS.ANDROID.CAMERA,
  });
}

// ===================== Worklet helpers =====================
function clamp(n: number, min: number, max: number) {
  'worklet';
  return Math.max(min, Math.min(max, n));
}

function getFrameRotationDegrees(frame: Frame) {
  'worklet';
  const r = frame.rotation;
  if (typeof r === 'number') return r; // 0/90/180/270

  switch (frame.orientation) {
    case 'portrait': return 0;
    case 'portrait-upside-down': return 180;
    case 'landscape-left': return 90;
    case 'landscape-right': return 270;
    default: return 0;
  }
}

function toCameraRotation(deg: number) {
  'worklet';
  const d = ((deg % 360) + 360) % 360;
  if (d === 90) return CameraRotation.ROTATION_90;
  if (d === 180) return CameraRotation.ROTATION_180;
  if (d === 270) return CameraRotation.ROTATION_270;
  return CameraRotation.ROTATION_0;
}

function uprightSizeForRotation(deg: number) {
  'worklet';
  const d = ((deg % 360) + 360) % 360;
  if (d === 90 || d === 270) return { w: SRC_H, h: SRC_W }; // 480x640
  return { w: SRC_W, h: SRC_H }; // 640x480
}

function normalizeRectToPx(rect: any, W: number, H: number) {
  'worklet';
  let x = Number(rect?.x ?? 0);
  let y = Number(rect?.y ?? 0);
  let w = Number(rect?.width ?? 0);
  let h = Number(rect?.height ?? 0);

  // 兼容 0~1
  if (w <= 1.5 && h <= 1.5) {
    x *= W; y *= H; w *= W; h *= H;
  }
  return { x, y, width: w, height: h };
}

// ===================== Smart transform (fix diagonal / wrong rotation) =====================
function scoreRect(
  r: { x: number; y: number; width: number; height: number },
  W: number,
  H: number
) {
  'worklet';
  const cx = r.x + r.width * 0.5;
  const cy = r.y + r.height * 0.5;

  let s = 0;
  if (r.width > 5 && r.height > 5) s += 1;
  if (r.width < W * 1.2 && r.height < H * 1.2) s += 1;
  if (cx >= 0 && cx <= W && cy >= 0 && cy <= H) s += 3;

  if (r.x < -W || r.y < -H || r.x > 2 * W || r.y > 2 * H) s -= 2;

  // 轻微中心约束，避免 90°时 CW/CCW 都“在范围内”但选错
  const dx = Math.abs(cx - W * 0.5) / W;
  const dy = Math.abs(cy - H * 0.5) / H;
  s -= (dx + dy) * 1.2;

  return s;
}

function transposeRect(r: { x: number; y: number; width: number; height: number }) {
  'worklet';
  return { x: r.y, y: r.x, width: r.height, height: r.width };
}

function rot90CW(r: { x: number; y: number; width: number; height: number }, W: number, H: number) {
  'worklet';
  return { x: H - (r.y + r.height), y: r.x, width: r.height, height: r.width, outW: H, outH: W };
}

function rot90CCW(r: { x: number; y: number; width: number; height: number }, W: number, H: number) {
  'worklet';
  return { x: r.y, y: W - (r.x + r.width), width: r.height, height: r.width, outW: H, outH: W };
}

function rot180(r: { x: number; y: number; width: number; height: number }, W: number, H: number) {
  'worklet';
  return { x: W - (r.x + r.width), y: H - (r.y + r.height), width: r.width, height: r.height, outW: W, outH: H };
}

/**
 * ✅ base(640×480) rect → upright rect
 * 自动在 4 种组合里挑最合理的（修复：对角线/方向反）
 * mode: 0..3
 *  - bit0: transpose
 *  - bit1: useCCW (否则CW)
 */
function baseRectToUprightSmart(
  rawBase: { x: number; y: number; width: number; height: number },
  rotDeg: number,
  uprightW: number,
  uprightH: number
) {
  'worklet';
  const d = ((rotDeg % 360) + 360) % 360;

  if (d === 0) return { ...rawBase, outW: SRC_W, outH: SRC_H, mode: 0, anchor: 0 };
  if (d === 180) return { ...rot180(rawBase, SRC_W, SRC_H), mode: 0, anchor: 0 };

  const want270 = (d === 270);

  let bestMode = 0;
  let bestScore = -1e9;
  let best: any = null;

  for (let mode = 0; mode < 4; mode++) {
    const doTranspose = (mode & 1) === 1;
    const useCCW = (mode & 2) === 2;

    const ccw = want270 ? !useCCW : useCCW;

    let r = doTranspose ? transposeRect(rawBase) : rawBase;

    const W = doTranspose ? SRC_H : SRC_W; // 480 or 640
    const H = doTranspose ? SRC_W : SRC_H; // 640 or 480

    const tr = ccw ? rot90CCW(r, W, H) : rot90CW(r, W, H);

    let s = scoreRect(tr, tr.outW, tr.outH);
    if (tr.outW === uprightW && tr.outH === uprightH) s += 2;

    if (s > bestScore) {
      bestScore = s;
      bestMode = mode;
      best = tr;
    }
  }

  return { ...best, mode: bestMode, anchor: 0 };
}

// ===================== 自动按 VisionCamera 实际预览比例映射（关键修复） =====================
// format.videoWidth/videoHeight 是“传感器原始方向”尺寸；rotDeg 后 upright 可能互换
function getUprightVideoSize(rotDeg: number, format: any) {
  const fw = Number(format?.videoWidth ?? 0);
  const fh = Number(format?.videoHeight ?? 0);
  const d = ((rotDeg % 360) + 360) % 360;
  if (!fw || !fh) return { w: 0, h: 0 };
  if (d === 90 || d === 270) return { w: fh, h: fw };
  return { w: fw, h: fh };
}

/**
 * ✅ 核心：rect(coordW/coordH) -> video(uprightW/uprightH) -> view(contain)
 * Maps a rectangle from the processing coordinate system to the view's coordinate system.
 */
function mapRectToViewContainByVideo(
  b: { x: number; y: number; width: number; height: number },
  coordW: number,
  coordH: number,
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
  rotDeg: number,
  isFrontCamera: boolean
) {
  'worklet';

  // 1. Map from processing coordinates `(coordW, coordH)` to video coordinates `(videoW, videoH)`.
  const videoX = (b.x / coordW) * videoW;
  let videoY = (b.y / coordH) * videoH;
  const videoW_ = (b.width / coordW) * videoW;
  const videoH_ = (b.height / coordH) * videoH;

  // 修复：在 90/270 度旋转时，Y 轴方向反了（用户反馈：人脸下移，框上移）
  // 这种情况通常发生在 Android 前置摄像头上
  const isRot90 = [90, 270].includes(((rotDeg % 360) + 360) % 360);
  if (isRot90 && isFrontCamera) {
    // 翻转 Y 轴: newY = H - (y + h)
    videoY = videoH - (videoY + videoH_);
  }

  // 2. Map from video coordinates to view coordinates, respecting "contain" resizeMode.
  const scale = Math.min(viewW / videoW, viewH / videoH);
  const offsetX = (viewW - videoW * scale) / 2;
  const offsetY = (viewH - videoH * scale) / 2;

  const viewX = videoX * scale + offsetX;
  const viewY = videoY * scale + offsetY;
  const viewW_ = videoW_ * scale;
  const viewH_ = videoH_ * scale;

  return {
    x: clamp(viewX, -viewW, viewW * 2),
    y: clamp(viewY, -viewH, viewH * 2),
    width: clamp(viewW_, 0, viewW * 2),
    height: clamp(viewH_, 0, viewH * 2),
  };
}

// ===================== Format helper（不固定比例） =====================
function pickBestFormat(device: any) {
  if (!device?.formats?.length) return undefined;
  // 不固定比例：优先较高 fps + 适中分辨率
  let best = device.formats[0];
  let bestScore = -1e18;

  for (const f of device.formats) {
    const w = Number(f.videoWidth ?? 0);
    const h = Number(f.videoHeight ?? 0);
    const fps = Number(f.maxFps ?? 30);
    const area = w * h;

    // 过大分辨率在安卓上会吃性能，轻微惩罚
    const areaPenalty = area / (1920 * 1080);

    const score = fps * 1000 - areaPenalty * 200;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }

  return best;
}

export default function RealTimeRecognitionScreen() {
  const [cameraType, setCameraType] = useState<'front' | 'back'>('front');
  const device = useCameraDevice(cameraType);
  const camera = useRef<Camera>(null);
  const { resize } = useResizePlugin();

  const [hubFaceCount, setHubFaceCount] = useState(0);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [boxes, setBoxes] = useState<FaceBoxUI[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const canvasSize = useSharedValue({ width: PREVIEW_W, height: PREVIEW_H });
  const font = useFont(require('./assets/fonts/PingFangSC-Regular.ttf'), 18);

  const [cameraInitialized, setCameraInitialized] = useState(false);
  const isFocused = useIsFocused();

  const [debug, setDebug] = useState({
    faceCount: 0,
    rotDeg: 0,
    mode: 0,
    anchor: 0,
    base: `${SRC_W}x${SRC_H}`,
    coord: `0x0`,
    video: `0x0`,
  });

  // Session 单例
  const sessionRef = useRef<any>(null);

  // JS 平滑
  const smoothRef = useRef(new Map<number, FaceBoxUI>());

  // 权限
  useFocusEffect(
    useCallback(() => {
      const requestPermission = async () => {
        const perm = getCameraPermissionConst();
        if (!perm) return setHasPermission(false);

        const st0 = await check(perm);
        if (st0 === RESULTS.GRANTED || st0 === RESULTS.LIMITED) {
          setHasPermission(true);
        } else {
          const st1 = await request(perm);
          setHasPermission(st1 === RESULTS.GRANTED || st1 === RESULTS.LIMITED);
        }
      };
      requestPermission();

      return () => {
        setIsCameraActive(false);
        setBoxes([]);
        smoothRef.current.clear();
      };
    }, [])
  );

  // 同步注册库
  useEffect(() => {
    if (!isFocused || !hasPermission) return;

    const loadRegisteredFaces = async () => {
      try {
        const allKeys = userInfoCacheStorage.getAllKeys();
        let cnt = 0;

        for (const key of allKeys) {
          const jsonString = userInfoCacheStorage.getString(key);
          if (!jsonString) continue;

          if (key === STORAGE_KEYS.REGISTERED_FACES) {
            const faces: RegisteredFacesDTO[] = JSON.parse(jsonString);
            cnt += faces.length;
          } else {
            try {
              const userData: RegisteredFacesDTO = JSON.parse(jsonString);
              if (userData?.faceId && userData.name) cnt += 1;
            } catch (e) {
              log(`解析用户数据失败: ${key}`, e);
            }
          }
        }

        const hubCount = InspireFace.featureHubGetFaceCount();
        setHubFaceCount(hubCount);
        log(`Reloaded faces: ${cnt}, hubCount: ${hubCount}`);
      } catch (e) {
        log('Reload faces error:', e);
      }
    };

    loadRegisteredFaces();
  }, [isFocused, hasPermission]);

  const boxedSession = useMemo(() => {
    if (sessionRef.current) return sessionRef.current;

    const s = InspireFace.createSession(
      { enableRecognition: true, enableFaceQuality: true },
      DetectMode.ALWAYS_DETECT,
      5,
      -1,
      15
    );
    s.setTrackPreviewSize(320);
    s.setFaceDetectThreshold(0.6);
    s.setTrackModeSmoothRatio(0.7);
    s.setTrackModeDetectInterval(10);
    s.setFilterMinimumFacePixelSize(50);

    const boxed = NitroModules.box(s);
    sessionRef.current = boxed;
    return boxed;
  }, []);

  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        try {
          const session = sessionRef.current.unbox();
          session?.dispose();
          sessionRef.current = null;
        } catch (e) {
          log('释放 Session 失败:', e);
        }
      }
      gAny.__IFACE_LAUNCHED = false;
    };
  }, []);

  const format = useMemo(() => pickBestFormat(device), [device]);

  const reportFacesToJS = useMemo(() => {
    let lastReportTime = 0;

    return Worklets.createRunOnJS(
      (payload: {
        faceCount: number;
        rotDeg: number;
        mode: number;
        anchor: number;
        coordW: number;
        coordH: number;
        faces: FaceBoxBuf[];
        isFrontCamera: boolean;
      }) => {
        const now = Date.now();
        if (now - lastReportTime < 66) return;
        lastReportTime = now;

        const vw = canvasSize.value?.width || PREVIEW_W;
        const vh = canvasSize.value?.height || PREVIEW_H;

        const { w: videoW0, h: videoH0 } = getUprightVideoSize(payload.rotDeg, format);
        const videoW = videoW0 || payload.coordW;
        const videoH = videoH0 || payload.coordH;

        setDebug({
          faceCount: payload.faceCount,
          rotDeg: payload.rotDeg,
          mode: payload.mode,
          anchor: payload.anchor,
          base: `${SRC_W}x${SRC_H}`,
          coord: `${payload.coordW}x${payload.coordH}`,
          video: `${videoW}x${videoH}`,
        });

        const alpha = 0.35;

        const next: FaceBoxUI[] = payload.faces.map((b) => {
          // ✅ 核心修复：传入旋转角度做精准映射
          const mapped = mapRectToViewContainByVideo(
            b,
            payload.coordW,
            payload.coordH,
            videoW,
            videoH,
            vw,
            vh,
            payload.rotDeg,
            payload.isFrontCamera
          );

          const id = b.trackId ?? 0;
          const prev = smoothRef.current.get(id);

          const smoothed = prev
            ? {
              x: prev.x + (mapped.x - prev.x) * alpha,
              y: prev.y + (mapped.y - prev.y) * alpha,
              width: prev.width + (mapped.width - prev.width) * alpha,
              height: prev.height + (mapped.height - prev.height) * alpha,
            }
            : mapped;

          const ui: FaceBoxUI = {
            ...smoothed,
            id,
            name: b.name,
            confidence: b.confidence,
            isMatched: b.isMatched,
          };

          smoothRef.current.set(id, ui);
          return ui;
        });

        const aliveIds = new Set(next.map((n) => n.id));
        smoothRef.current.forEach((_, key) => {
          if (!aliveIds.has(key)) smoothRef.current.delete(key);
        });

        setBoxes(next);
      }
    );
  }, [canvasSize, format]);

  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';

      const g: any = globalThis as any;
      if (g.__dlx_busy) return;
      g.__dlx_busy = true;

      try {
        runAtTargetFps(15, () => {
          'worklet';

          let bitmap: any = null;
          let imageStream: any = null;
          const isFront = cameraType === 'front';

          try {
            // ✅ resize 只做缩放，不旋转不镜像（保证 SDK 识别稳定）
            const resized = resize(frame, {
              scale: { width: SRC_W, height: SRC_H },
              rotation: '0deg',
              pixelFormat: 'bgr',
              dataType: 'uint8',
              mirror: false,
            });

            if (!resized?.buffer) {
              reportFacesToJS({ faceCount: 0, rotDeg: 0, mode: 0, anchor: 0, coordW: SRC_W, coordH: SRC_H, faces: [], isFrontCamera: isFront });
              return;
            }

            const rotDeg = getFrameRotationDegrees(frame);
            const camRot = toCameraRotation(rotDeg);

            const upright = uprightSizeForRotation(rotDeg);
            const uprightW = upright.w;
            const uprightH = upright.h;

            const unboxed = BoxedInspireFace.unbox();
            if (!unboxed) {
              reportFacesToJS({ faceCount: 0, rotDeg, mode: 0, anchor: 0, coordW: uprightW, coordH: uprightH, faces: [], isFrontCamera: isFront });
              return;
            }

            bitmap = unboxed.createImageBitmapFromBuffer(resized.buffer as ArrayBuffer, SRC_W, SRC_H, 3);
            imageStream = unboxed.createImageStreamFromBitmap(bitmap, camRot);

            const session = boxedSession.unbox();
            if (!session) {
              reportFacesToJS({ faceCount: 0, rotDeg, mode: 0, anchor: 0, coordW: uprightW, coordH: uprightH, faces: [], isFrontCamera: isFront });
              return;
            }

            const facesAny: any = session.executeFaceTrack(imageStream);

            const faceCount = (() => {
              if (!facesAny) return 0;
              if (typeof facesAny.length === 'number') return facesAny.length;
              if (typeof facesAny.detectedNum === 'number') return facesAny.detectedNum;
              return 0;
            })();

            if (faceCount <= 0) {
              reportFacesToJS({ faceCount: 0, rotDeg, mode: 0, anchor: 0, coordW: uprightW, coordH: uprightH, faces: [], isFrontCamera: isFront });
              return;
            }

            // ✅ 画框坐标系统一使用 uprightW/uprightH（后续 JS 会自动映射到 video/preview）
            const coordW = uprightW;
            const coordH = uprightH;

            // ✅ 镜像只发生一次：看顶部开关
            const mirrorUI = isFront && MIRROR_ON_OVERLAY;

            let chosenMode = 0;
            let chosenAnchor = 0;

            const out: FaceBoxBuf[] = [];

            for (let i = 0; i < faceCount; i++) {
              const f = facesAny[i] ?? {
                token: facesAny.tokens?.[i],
                rect: facesAny.rects?.[i],
                trackId: facesAny.trackIds?.[i] ?? facesAny.ids?.[i],
              };
              if (!f?.rect || !f?.token) continue;

              const rawBase = normalizeRectToPx(f.rect, SRC_W, SRC_H);

              // ✅ 智能把 base rect 转到 upright rect（修复对角线/方向反）
              const smart = baseRectToUprightSmart(rawBase, rotDeg, uprightW, uprightH);
              if (i === 0) {
                chosenMode = smart.mode;
                chosenAnchor = smart.anchor ?? 0;
              }

              let rU = smart; // x/y/width/height/outW/outH

              if (SDK_Y_ORIGIN_BOTTOM) {
                rU = { ...rU, y: rU.outH - (rU.y + rU.height) };
              }

              if (mirrorUI) {
                rU = { ...rU, x: rU.outW - (rU.x + rU.width) };
              }

              const bx = clamp(rU.x, -rU.outW, rU.outW * 2);
              const by = clamp(rU.y, -rU.outH, rU.outH * 2);
              const bw = clamp(rU.width, 0, rU.outW * 2);
              const bh = clamp(rU.height, 0, rU.outH * 2);

              let searched: any = null;
              try {
                const feature = session.extractFaceFeature(imageStream, f.token);
                searched = unboxed.featureHubFaceSearch(feature);
              } catch {
                searched = { name: '识别失败', confidence: 0 };
              }

              const name = searched?.name || '未注册';
              const confidence = searched?.confidence || 0;
              const isMatched = !!(searched?.name && confidence > 0.5);

              out.push({
                x: bx,
                y: by,
                width: bw,
                height: bh,
                trackId: Number(f.trackId ?? i),
                name,
                confidence,
                isMatched,
              });
            }

            reportFacesToJS({
              faceCount,
              rotDeg,
              mode: chosenMode,
              anchor: chosenAnchor,
              coordW,
              coordH,
              faces: out,
              isFrontCamera: isFront,
            });
          } catch {
            reportFacesToJS({ faceCount: 0, rotDeg: 0, mode: 0, anchor: 0, coordW: SRC_W, coordH: SRC_H, faces: [], isFrontCamera: isFront });
          } finally {
            try { if (imageStream) imageStream.dispose(); } catch {}
            try { if (bitmap) bitmap.dispose(); } catch {}
          }
        });
      } finally {
        g.__dlx_busy = false;
      }
    },
    [resize, boxedSession, reportFacesToJS, cameraType]
  );

  const toggleCamera = useCallback(() => {
    setCameraType((p) => (p === 'front' ? 'back' : 'front'));
    setBoxes([]);
    smoothRef.current.clear();
  }, []);

  const startRecognition = useCallback(() => {
    if (cameraInitialized) setIsCameraActive(true);
  }, [cameraInitialized]);

  const stopRecognition = useCallback(() => {
    setIsCameraActive(false);
    setBoxes([]);
    smoothRef.current.clear();
  }, []);

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.text}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission not granted.</Text>
        <TouchableOpacity onPress={() => openSettings()}>
          <Text style={styles.linkText}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>No camera device found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused && cameraInitialized && isCameraActive}
        format={format}
        frameProcessor={frameProcessor}
        frameProcessorFps={15}
        resizeMode="contain"
        zoom={0}
        // ✅ 镜像只在预览或画框二选一
        isMirrored={cameraType === 'front' && MIRROR_ON_PREVIEW}
        onInitialized={() => setCameraInitialized(true)}
        onError={(error) => {
          log('Camera 错误:', error);
          setIsCameraActive(false);
        }}
      />

      <Canvas
        style={StyleSheet.absoluteFill}
        onSize={(size) => {
          canvasSize.value = size;
        }}
      >
        {boxes.map((b) => {
          let label = b.name || `ID:${b.id}`;
          if (b.isMatched && b.confidence) label += ` (${(b.confidence * 100).toFixed(1)}%)`;

          const boxColor = b.isMatched ? COLOR_GREEN : COLOR_RED;
          const bgColor = b.isMatched ? BG_GREEN : BG_RED;
          const textColor = b.isMatched ? COLOR_BLACK : COLOR_WHITE;

          if (!font) return null;

          const padX = 6;
          const padY = 4;
          const textW = font.getTextWidth(label) + padX * 2;
          const textH = font.getSize() + padY * 2 + 6;
          const bgX = b.x;
          const bgY = Math.max(0, b.y - textH - 6);

          return (
            <React.Fragment key={`face-box-${b.id}`}>
              <Rect
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                color={boxColor}
                style="stroke"
                strokeWidth={3}
              />
              <Rect x={bgX} y={bgY} width={textW} height={textH} color={bgColor} />
              <SkiaText
                x={bgX + padX}
                y={bgY + textH - padY - 4}
                text={label}
                font={font}
                color={textColor}
              />
            </React.Fragment>
          );
        })}

        {font && (
          <>
            <Rect x={10} y={40} width={760} height={78} color={BG_BLACK50} />
            <SkiaText
              x={20}
              y={65}
              text={`hub:${hubFaceCount} faces:${debug.faceCount} rot:${debug.rotDeg} mode:${debug.mode} anchor:${debug.anchor}`}
              font={font}
              color={COLOR_WHITE}
            />
            <SkiaText
              x={20}
              y={88}
              text={`base:${debug.base} coord:${debug.coord} video:${debug.video}`}
              font={font}
              color={COLOR_WHITE}
            />
          </>
        )}
      </Canvas>

      <View style={styles.controlsContainer}>
        <TouchableOpacity style={styles.button} onPress={toggleCamera}>
          <Text style={styles.buttonText}>切换</Text>
        </TouchableOpacity>

        {!isCameraActive ? (
          <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={startRecognition}>
            <Text style={styles.buttonText}>开始</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={stopRecognition}>
            <Text style={styles.buttonText}>停止</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'black' },
  text: { color: 'white', fontSize: 16, marginTop: 10 },
  linkText: { color: '#007AFF', fontSize: 16, marginTop: 10 },
  controlsContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  button: {
    backgroundColor: 'rgba(128,128,128,0.8)',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 30,
    minWidth: 100,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  primaryButton: { backgroundColor: 'rgba(0, 122, 255, 0.8)' },
  dangerButton: { backgroundColor: 'rgba(255, 59, 48, 0.8)' },
});
