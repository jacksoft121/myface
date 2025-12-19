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

// ====== 只 launch 一次 ======
const gAny: any = globalThis as any;
if (!gAny.__IFACE_LAUNCHED) {
  InspireFace.launch('Pikachu');
  gAny.__IFACE_LAUNCHED = true;
}

// ====== 常量 ======
const { width: PREVIEW_W, height: PREVIEW_H } = Dimensions.get('window');

// 分析分辨率（和你 Kotlin 目标一致）
const SRC_W = 640;
const SRC_H = 480;

// Skia：用 number 色值
const COLOR_GREEN = 0xff00ff00;
const COLOR_RED = 0xffff0000;
const BG_GREEN = 0xd900ff00;
const BG_RED = 0xd9ff0000;
const BG_BLACK50 = 0x80000000;
const COLOR_WHITE = 0xffffffff;
const COLOR_BLACK = 0xff000000;

// ====== Permission ======
function getCameraPermissionConst() {
  return Platform.select({
    ios: PERMISSIONS.IOS.CAMERA,
    android: PERMISSIONS.ANDROID.CAMERA,
    default: PERMISSIONS.ANDROID.CAMERA,
  });
}

// ====== worklet-safe helpers ======
function clamp(n: number, min: number, max: number) {
  'worklet';
  return Math.max(min, Math.min(max, n));
}

// “图像坐标(srcW/srcH)” → “屏幕 contain 坐标”
function mapRectToViewContain(
  b: { x: number; y: number; width: number; height: number },
  srcW: number,
  srcH: number,
  viewW: number,
  viewH: number
) {
  'worklet';
  const scale = Math.min(viewW / srcW, viewH / srcH);
  const scaledW = srcW * scale;
  const scaledH = srcH * scale;
  const offsetX = (viewW - scaledW) / 2;
  const offsetY = (viewH - scaledH) / 2;

  const x = b.x * scale + offsetX;
  const y = b.y * scale + offsetY;
  const w = b.width * scale;
  const h = b.height * scale;

  return {
    x: clamp(x, -viewW, viewW * 2),
    y: clamp(y, -viewH, viewH * 2),
    width: clamp(w, 0, viewW * 2),
    height: clamp(h, 0, viewH * 2),
  };
}

// frame.rotation(优先) / frame.orientation(兜底) → rotationDegrees
function getFrameRotationDegrees(frame: Frame) {
  'worklet';
  const r = frame.rotation;
  if (typeof r === 'number') return r; // 0/90/180/270

  // 兜底：orientation string
  switch (frame.orientation) {
    case 'portrait': return 0;
    case 'portrait-upside-down': return 180;
    case 'landscape-left': return 90;
    case 'landscape-right': return 270;
    default: return 0;
  }
}

// rotationDegrees → InspireFace CameraRotation
function toCameraRotation(deg: number) {
  'worklet';
  const d = ((deg % 360) + 360) % 360;
  if (d === 90) return CameraRotation.ROTATION_90;
  if (d === 180) return CameraRotation.ROTATION_180;
  if (d === 270) return CameraRotation.ROTATION_270;
  return CameraRotation.ROTATION_0;
}

// 给定 rotationDegrees，upright 的宽高
function uprightSizeForRotation(deg: number) {
  'worklet';
  const d = ((deg % 360) + 360) % 360;
  if (d === 90 || d === 270) return { w: SRC_H, h: SRC_W };
  return { w: SRC_W, h: SRC_H };
}

/**
 * ✅ 关键：自动选“rect 坐标变换模式”，专治你这个“对角线反”
 * - 我们不知道 SDK rect 属于哪套坐标（是否转过/是否轴互换/是否原点翻）
 * - 所以一帧里尝试 8 种模式（4个旋转 * 是否transpose）
 * - 选“落在画面内最多”的那个作为本帧的 rect 修正模式
 */
function transformRectMode(
  rect: { x: number; y: number; width: number; height: number },
  baseW: number,
  baseH: number,
  mode: number
) {
  'worklet';
  let x = rect.x, y = rect.y, w = rect.width, h = rect.height;

  // mode: 0..3 = rotate 0/90/180/270
  // mode: 4..7 = transpose + rotate 0/90/180/270
  const transpose = mode >= 4;
  const rot = mode % 4;

  if (transpose) {
    // 对角线反：swap x<->y & w<->h
    const tx = y; const ty = x;
    const tw = h; const th = w;
    x = tx; y = ty; w = tw; h = th;

    // transpose 后，坐标基准也相当于交换
    const tmp = baseW; baseW = baseH; baseH = tmp;
  }

  // 再做旋转（把“某坐标系”转到 upright）
  // 注意：这里用 baseW/baseH 做旋转公式
  if (rot === 0) {
    return { x, y, width: w, height: h, outW: baseW, outH: baseH };
  }

  if (rot === 1) {
    // rotate 90 CW
    // (x, y) -> (baseH - (y+h), x)
    return {
      x: baseH - (y + h),
      y: x,
      width: h,
      height: w,
      outW: baseH,
      outH: baseW,
    };
  }

  if (rot === 2) {
    // rotate 180
    return {
      x: baseW - (x + w),
      y: baseH - (y + h),
      width: w,
      height: h,
      outW: baseW,
      outH: baseH,
    };
  }

  // rot === 3 : rotate 270 CW (or 90 CCW)
  return {
    x: y,
    y: baseW - (x + w),
    width: h,
    height: w,
    outW: baseH,
    outH: baseW,
  };
}

function scoreRectInBounds(
  r: { x: number; y: number; width: number; height: number },
  W: number,
  H: number
) {
  'worklet';
  const cx = r.x + r.width * 0.5;
  const cy = r.y + r.height * 0.5;
  let s = 0;

  if (r.width > 4 && r.height > 4) s += 1;
  if (r.width < W * 1.2 && r.height < H * 1.2) s += 1;
  if (cx >= 0 && cx <= W && cy >= 0 && cy <= H) s += 3;

  // 轻微惩罚离谱值
  if (r.x < -W || r.y < -H || r.x > 2 * W || r.y > 2 * H) s -= 2;

  return s;
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

  return {
    x, y,
    width: w,
    height: h,
  };
}

// format 选择（可留可删）
function pickBestFormat(device: any) {
  if (!device?.formats?.length) return undefined;
  const targetArea = SRC_W * SRC_H;

  let best = device.formats[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const f of device.formats) {
    const area = (f.videoWidth ?? 0) * (f.videoHeight ?? 0);
    const areaDiff = Math.abs(area - targetArea);
    const maxFps = f.maxFps ?? 30;
    const score = areaDiff - maxFps * 1000;
    if (score < bestScore) {
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
    chosenMode: 0,
    base: `${SRC_W}x${SRC_H}`,
    upright: `0x0`,
  });

  // 🔧 新增：防止重复初始化 Session
  const sessionRef = useRef<any>(null);

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

      // 🔧 组件失焦时清理状态
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
        console.warn('Reload faces error:', e);
        log('Reload faces error:', e);
      }
    };

    loadRegisteredFaces();
  }, [isFocused, hasPermission]);

  // 🔧 修复：Session 初始化逻辑（防止重复创建）
  const boxedSession = useMemo(() => {
    if (sessionRef.current) return sessionRef.current;

    try {
      const s = InspireFace.createSession(
        { enableRecognition: true, enableFaceQuality: true },
        DetectMode.ALWAYS_DETECT,
        5,
        -1,
        15 // 🔧 限制跟踪帧率，降低性能消耗
      );
      s.setTrackPreviewSize(320);
      s.setFaceDetectThreshold(0.6); // 🔧 提高检测阈值，减少误检
      s.setTrackModeSmoothRatio(0.7);
      s.setTrackModeDetectInterval(10);
      s.setFilterMinimumFacePixelSize(50);

      const boxed = NitroModules.box(s);
      sessionRef.current = boxed;
      return boxed;
    } catch (e) {
      log('创建 Session 失败:', e);
      throw e;
    }
  }, []);

  // 🔧 修复：组件卸载时释放 Session
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

  // JS 平滑
  const smoothRef = useRef(new Map<number, FaceBoxUI>());

  // 🔧 优化：防抖逻辑 + 类型安全
  const reportFacesToJS = useMemo(() => {
    let lastReportTime = 0;
    return Worklets.createRunOnJS(
      (payload: {
        faceCount: number;
        rotDeg: number;
        chosenMode: number;
        uprightW: number;
        uprightH: number;
        faces: FaceBoxBuf[];
      }) => {
        // 防抖：66ms 内只更新一次（约15fps）
        const now = Date.now();
        if (now - lastReportTime < 66) return;
        lastReportTime = now;

        setDebug({
          faceCount: payload.faceCount,
          rotDeg: payload.rotDeg,
          chosenMode: payload.chosenMode,
          base: `${SRC_W}x${SRC_H}`,
          upright: `${payload.uprightW}x${payload.uprightH}`,
        });

        const alpha = 0.35;

        const next: FaceBoxUI[] = payload.faces.map((b) => {
          const mapped = mapRectToViewContain(b, payload.uprightW, payload.uprightH, PREVIEW_W, PREVIEW_H);

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

        // 清理过期的 trackId
        const aliveIds = new Set(next.map((n) => n.id));
        smoothRef.current.forEach((_, key) => {
          if (!aliveIds.has(key)) smoothRef.current.delete(key);
        });

        setBoxes(next);
      }
    );
  }, []);

  // 🔧 核心修复：FrameProcessor 性能 + 错误处理 + 类型安全
  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';

      const g: any = globalThis as any;
      if (g.__dlx_busy) return;
      g.__dlx_busy = true;

      try {
        // 🔧 降低处理帧率到15fps，平衡性能和体验
        runAtTargetFps(15, () => {
          'worklet';

          let bitmap: any = null;
          let imageStream: any = null;

          try {
            // ✅ 只 resize，不旋转、不镜像（避免坐标系搞乱）
            const resized = resize(frame, {
              scale: { width: SRC_W, height: SRC_H },
              rotation: '0deg',
              pixelFormat: 'bgr',
              dataType: 'uint8',
              mirror: false,
            });

            if (!resized || !resized.buffer) {
              console.error('[Worklet] Resize 插件返回空数据');
              reportFacesToJS({
                faceCount: 0,
                rotDeg: 0,
                chosenMode: 0,
                uprightW: SRC_W,
                uprightH: SRC_H,
                faces: [],
              });
              return;
            }

            // 用 frame 的真实旋转告诉 InspireFace
            const rotDeg = getFrameRotationDegrees(frame);
            const camRot = toCameraRotation(rotDeg);

            // upright 尺寸（用于最终画框坐标系）
            const upright = uprightSizeForRotation(rotDeg);
            const uprightW = upright.w;
            const uprightH = upright.h;

            const unboxed = BoxedInspireFace.unbox();
            if (!unboxed) {
              console.error('[Worklet] 无法获取 InspireFace 实例');
              reportFacesToJS({
                faceCount: 0,
                rotDeg,
                chosenMode: 0,
                uprightW,
                uprightH,
                faces: [],
              });
              return;
            }

            // 🔧 修复：使用动态计算的尺寸创建 bitmap
            bitmap = unboxed.createImageBitmapFromBuffer(
              resized.buffer as ArrayBuffer,
              SRC_W,
              SRC_H,
              3 // BGR 通道数
            );

            imageStream = unboxed.createImageStreamFromBitmap(bitmap, camRot);

            const session = boxedSession.unbox();
            if (!session) {
              console.error('[Worklet] Session 未初始化');
              reportFacesToJS({
                faceCount: 0,
                rotDeg,
                chosenMode: 0,
                uprightW,
                uprightH,
                faces: [],
              });
              return;
            }

            const facesAny: any = session.executeFaceTrack(imageStream);

            // 🔧 兼容不同的返回格式
            const faceCount = (() => {
              if (!facesAny) return 0;
              if (typeof facesAny.length === 'number') return facesAny.length;
              if (typeof facesAny.detectedNum === 'number') return facesAny.detectedNum;
              return 0;
            })();

            if (faceCount <= 0) {
              reportFacesToJS({
                faceCount: 0,
                rotDeg,
                chosenMode: 0,
                uprightW,
                uprightH,
                faces: [],
              });
              return;
            }

            // 先收集 raw rect（最多取前3个用来选模式）
            const rawRects: { x: number; y: number; width: number; height: number }[] = [];

            for (let i = 0; i < faceCount && i < 3; i++) {
              const f = facesAny[i] ?? {
                token: facesAny.tokens?.[i],
                rect: facesAny.rects?.[i],
                trackId: facesAny.trackIds?.[i] ?? facesAny.ids?.[i],
              };

              if (!f?.rect) continue;
              rawRects.push(normalizeRectToPx(f.rect, SRC_W, SRC_H));
            }

            // ✅ 选最匹配的模式（8种）
            let bestMode = 0;
            let bestScore = -999999;

            for (let mode = 0; mode < 8; mode++) {
              let s = 0;
              for (let i = 0; i < rawRects.length; i++) {
                const tr = transformRectMode(rawRects[i], SRC_W, SRC_H, mode);
                // tr.outW/outH 是该模式下的坐标空间尺寸
                // 我们最终要的是 uprightW/uprightH，所以只给“尺寸一致”的模式更高分
                const sizeMatch = (tr.outW === uprightW && tr.outH === uprightH) ? 2 : 0;
                s += scoreRectInBounds(tr, tr.outW, tr.outH) + sizeMatch;
              }
              if (s > bestScore) {
                bestScore = s;
                bestMode = mode;
              }
            }

            // 生成最终 boxes（在 upright 坐标系）
            const out: FaceBoxBuf[] = [];

            for (let i = 0; i < faceCount; i++) {
              const f = facesAny[i] ?? {
                token: facesAny.tokens?.[i],
                rect: facesAny.rects?.[i],
                trackId: facesAny.trackIds?.[i] ?? facesAny.ids?.[i],
              };

              if (!f?.rect || !f?.token) continue;

              const raw = normalizeRectToPx(f.rect, SRC_W, SRC_H);
              const tr = transformRectMode(raw, SRC_W, SRC_H, bestMode);

              // ✅ 前摄：只在“画框坐标系”做镜像（与 <Camera isMirrored> 保持一致）
              const mirrorUI = cameraType === 'front';
              let fx = tr.x;
              if (mirrorUI) fx = tr.outW - (tr.x + tr.width);

              // clamp 防止越界
              const bx = clamp(fx, -tr.outW, tr.outW * 2);
              const by = clamp(tr.y, -tr.outH, tr.outH * 2);
              const bw = clamp(tr.width, 0, tr.outW * 2);
              const bh = clamp(tr.height, 0, tr.outH * 2);

              // 🔧 增加错误处理：防止特征提取失败
              let feature: any = null;
              let searched: any = null;
              try {
                feature = session.extractFaceFeature(imageStream, f.token);
                searched = unboxed.featureHubFaceSearch(feature);
              } catch (e) {
                console.error(`[Worklet] 提取特征失败: ${e?.message}`);
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
              chosenMode: bestMode,
              uprightW,
              uprightH,
              faces: out,
            });
          } catch (e: any) {
            console.error('[Worklet] FaceTrack 处理失败:', e?.message ?? e);
            reportFacesToJS({
              faceCount: 0,
              rotDeg: 0,
              chosenMode: 0,
              uprightW: SRC_W,
              uprightH: SRC_H,
              faces: [],
            });
          } finally {
            // 🔧 确保资源释放
            try { if (imageStream) imageStream.dispose(); } catch (e) {}
            try { if (bitmap) bitmap.dispose(); } catch (e) {}
          }
        });
      } finally {
        g.__dlx_busy = false;
      }
    },
    [resize, boxedSession, reportFacesToJS, cameraType]
  );

  // 🔧 优化：切换摄像头时重置状态
  const toggleCamera = useCallback(() => {
    setCameraType((p) => (p === 'front' ? 'back' : 'front'));
    setBoxes([]);
    smoothRef.current.clear();
  }, []);

  const startRecognition = useCallback(() => {
    if (cameraInitialized) {
      setIsCameraActive(true);
    }
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
        frameProcessorFps={15} // 🔧 匹配处理帧率
        resizeMode="contain"
        zoom={0}
        isMirrored={cameraType === 'front'}
        onInitialized={() => setCameraInitialized(true)}
        onError={(error) => {
          log('Camera 错误:', error);
          setIsCameraActive(false);
        }}
      />

      {/* 🔧 修复：Canvas 尺寸同步 + 防止空渲染 */}
      <Canvas style={StyleSheet.absoluteFill} onSize={(size) => {
        canvasSize.value = size;
      }}>
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

        {/* 调试信息 */}
        {font && (
          <>
            <Rect x={10} y={40} width={390} height={30} color={BG_BLACK50} />
            <SkiaText
              x={20}
              y={65}
              text={`hub:${hubFaceCount} faces:${debug.faceCount} rot:${debug.rotDeg} mode:${debug.chosenMode} base:${debug.base} up:${debug.upright}`}
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
