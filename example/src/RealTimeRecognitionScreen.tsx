import 'react-native-worklets-core';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect, useIsFocused} from '@react-navigation/native';

import {
  BoxedInspireFace,
  CameraRotation,
  DetectMode,
  InspireFace,
} from 'react-native-nitro-inspire-face';
import {NitroModules} from 'react-native-nitro-modules';

import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
  runAtTargetFps,
  type Frame,
} from 'react-native-vision-camera';
import {useResizePlugin} from 'vision-camera-resize-plugin';

import {
  check,
  request,
  openSettings,
  PERMISSIONS,
  RESULTS,
} from 'react-native-permissions';

import {Worklets} from 'react-native-worklets-core';
import {
  Skia,
  ColorType,
  AlphaType,
  ImageFormat,
  Canvas,
  Rect,
  Text as SkiaText,
  useFont
} from '@shopify/react-native-skia';
import {useSharedValue} from 'react-native-reanimated';

import {type RegisteredFacesDTO, type FaceBoxBuf, type FaceBoxUI} from './dto/DlxTypes';
import {DLX_CONFIG, STORAGE_KEYS, userInfoCacheStorage} from './comm/GlobalStorage';
import {log} from './comm/logger';
import {queryUserByFaceId} from "./comm/FaceDB";

import RNFS from 'react-native-fs';


// ===================== 镜像开关（只改这里） =====================
// 方案A：镜像预览 + 画框不镜像（推荐）
const MIRROR_ON_PREVIEW = true;
const MIRROR_ON_OVERLAY = !MIRROR_ON_PREVIEW;

// 调整人脸框位置：向上偏移比例（解决框偏下问题）
const FACE_BOX_Y_OFFSET_RATIO = DLX_CONFIG.FACE_BOX_Y_OFFSET_RATIO;
// 模型名称
const INSPIREFACE_MODEL_NAME = DLX_CONFIG.INSPIREFACE_MODEL_NAME;

// 极少数机型 SDK y 原点在左下角才需要（一般 false）
const SDK_Y_ORIGIN_BOTTOM = false;

// ===================== Launch once =====================
const gAny: any = globalThis as any;
if (!gAny.__IFACE_LAUNCHED) {
  InspireFace.launch(INSPIREFACE_MODEL_NAME);
  gAny.__IFACE_LAUNCHED = true;
}

// ===================== Const =====================
const {width: PREVIEW_W, height: PREVIEW_H} = Dimensions.get('window');

// ✅ 输入给 SDK 的稳定尺寸：永远 640x480
const SRC_W = DLX_CONFIG.INSPIREFACE_SRC_W;
const SRC_H = DLX_CONFIG.INSPIREFACE_SRC_H;

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
  switch (frame.orientation) {
    case 'portrait':
      return 0;
    case 'portrait-upside-down':
      return 180;
    case 'landscape-left':
      return 90;
    case 'landscape-right':
      return 270;
    default:
      return 0;
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
  if (d === 90 || d === 270) return {w: SRC_H, h: SRC_W}; // 480x640
  return {w: SRC_W, h: SRC_H}; // 640x480
}

function normalizeRectToPx(rect: any, W: number, H: number) {
  'worklet';
  let x = Number(rect?.x ?? 0);
  let y = Number(rect?.y ?? 0);
  let w = Number(rect?.width ?? 0);
  let h = Number(rect?.height ?? 0);

  // 兼容 0~1
  if (w <= 1.5 && h <= 1.5) {
    x *= W;
    y *= H;
    w *= W;
    h *= H;
  }
  return {x, y, width: w, height: h};
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
  return {x: r.y, y: r.x, width: r.height, height: r.width};
}

function rot90CW(r: { x: number; y: number; width: number; height: number }, W: number, H: number) {
  'worklet';
  return {x: H - (r.y + r.height), y: r.x, width: r.height, height: r.width, outW: H, outH: W};
}

function rot90CCW(r: { x: number; y: number; width: number; height: number }, W: number, H: number) {
  'worklet';
  return {x: r.y, y: W - (r.x + r.width), width: r.height, height: r.width, outW: H, outH: W};
}

function rot180(r: { x: number; y: number; width: number; height: number }, W: number, H: number) {
  'worklet';
  return {x: W - (r.x + r.width), y: H - (r.y + r.height), width: r.width, height: r.height, outW: W, outH: H};
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

  if (d === 0) return {...rawBase, outW: SRC_W, outH: SRC_H, mode: 0, anchor: 0};
  if (d === 180) return {...rot180(rawBase, SRC_W, SRC_H), mode: 0, anchor: 0};

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

  return {...best, mode: bestMode, anchor: 0};
}

// ===================== 自动按 VisionCamera 实际预览比例映射（关键修复） =====================
// format.videoWidth/videoHeight 是“传感器原始方向”尺寸；rotDeg 后 upright 可能互换
function getUprightVideoSize(rotDeg: number, format: any) {
  const fw = Number(format?.videoWidth ?? 0);
  const fh = Number(format?.videoHeight ?? 0);
  const d = ((rotDeg % 360) + 360) % 360;
  if (!fw || !fh) return {w: 0, h: 0};
  if (d === 90 || d === 270) return {w: fh, h: fw};
  return {w: fw, h: fh};
}

/**
 * ✅ 核心：rect(coordW/coordH) -> video(uprightW/uprightH) -> view(contain/cover)
 * Maps a rectangle from the processing coordinate system to the view's coordinate system.
 */
function mapRectToView(
  b: { x: number; y: number; width: number; height: number },
  coordW: number, // 这是 SDK 输出的坐标系宽度 (例如 480)
  coordH: number, // 这是 SDK 输出的坐标系高度 (例如 640)
  viewW: number,  // 屏幕 Canvas 宽度
  viewH: number,  // 屏幕 Canvas 高度
  resizeMode: string
) {
  'worklet';

  // 计算缩放比例：直接计算 SDK 坐标系到 View 坐标系的缩放
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (resizeMode === 'cover') {
    scale = Math.max(viewW / coordW, viewH / coordH);
  } else {
    // contain 模式
    scale = Math.min(viewW / coordW, viewH / coordH);
  }

  // 计算居中偏移
  offsetX = (viewW - coordW * scale) / 2;
  offsetY = (viewH - coordH * scale) / 2;

  // 映射坐标
  const viewX = b.x * scale + offsetX;
  const viewY = b.y * scale + offsetY;
  const viewW_ = b.width * scale;
  const viewH_ = b.height * scale;

  return {
    x: viewX,
    y: viewY,
    width: viewW_,
    height: viewH_,
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
  const [frameProcessorFps, setFrameProcessorFps] = useState(DLX_CONFIG.INSPIREFACE_FRAME_PROCESSOR_FPS);
  const [confidenceThreshold, setConfidenceThreshold] = useState(DLX_CONFIG.INSPIREFACE_CONFIDENCE_THRESHOLD);
  const device = useCameraDevice(cameraType);
  const camera = useRef<Camera>(null);
  const {resize} = useResizePlugin();

  const [hubFaceCount, setHubFaceCount] = useState(0);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [boxes, setBoxes] = useState<FaceBoxUI[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const canvasSize = useSharedValue({width: PREVIEW_W, height: PREVIEW_H});
  const font = useFont(require('./assets/fonts/PingFangSC-Regular.ttf'), 18);

  const [cameraInitialized, setCameraInitialized] = useState(false);
  const isFocused = useIsFocused();

  // ✅ 定义当前的 resizeMode，方便统一修改
  const CURRENT_RESIZE_MODE: 'contain' | 'cover' = 'cover';

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
      {enableRecognition: true, enableFaceQuality: true},
      DetectMode.ALWAYS_DETECT,
      5,
      -1,
      15
    );
    s.setTrackPreviewSize(DLX_CONFIG.INSPIREFACE_SRC_W);
    s.setFaceDetectThreshold(DLX_CONFIG.INSPIREFACE_FACE_DETECT_THRESHOLD);
    s.setTrackModeSmoothRatio(DLX_CONFIG.INSPIREFACE_TRACK_MODE_SMOOTH_RATIO);
    s.setTrackModeDetectInterval(DLX_CONFIG.INSPIREFACE_TRACK_MODE_DETECT_INTERVAL);
    s.setFilterMinimumFacePixelSize(DLX_CONFIG.INSPIREFACE_FILTER_MINIMUM_FACE_PIXEL_SIZE);

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

        const {w: videoW0, h: videoH0} = getUprightVideoSize(payload.rotDeg, format);
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

        const alpha = 0.75;
        const isAndroid = Platform.OS === 'android';

        const next: FaceBoxUI[] = payload.faces.map((b) => {
          const mapped = mapRectToView(
            b,
            payload.coordW,
            payload.coordH,
            vw,
            vh,
            CURRENT_RESIZE_MODE
          );


          // 修正：整体上移，解决框偏下（眉毛到颈部）的问题
          // mapped.y -= mapped.height * FACE_BOX_Y_OFFSET_RATIO;

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
            name: b.name || '',
            confidence: b.confidence,
            isMatched: b.isMatched,
          };
          if (b.isMatched) {
            b.hubId = Number(b.hubId);
            const user = queryUserByFaceId(b.hubId);
            if (user) {
              ui.name = user.name || '未注册';
            }
          }
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


  // 1. 增加拍照状态
  const shouldCapture = useMemo(() => Worklets.createSharedValue(false), []); // Worklets-core 方式
  const [isSaving, setIsSaving] = useState(false);

  const saveImage = useMemo(
    () =>
      Worklets.createRunOnJS(
        async (payload: { base64: string; width: number; height: number; format: 'bgr' | 'rgba' }) => {
          console.log('--- JS线程: saveImage 开始处理 ---');
          setIsSaving(true);

          try {
            const { base64, width, height, format } = payload;

            // 1) base64 -> ArrayBuffer -> Uint8Array
            console.log('base64.len=', base64?.length);
            const unboxed = BoxedInspireFace.unbox();
            const buffer: ArrayBuffer = unboxed.fromBase64(base64);
            const srcPixels = new Uint8Array(buffer);

            const expectedLen = format === 'bgr' ? width * height * 3 : width * height * 4;
            console.log(`JS线程: 尺寸 ${width}x${height}, format=${format}, 数据长度: ${srcPixels.length}, expected=${expectedLen}`);

            if (srcPixels.length < expectedLen) {
              throw new Error(`像素长度不匹配：got=${srcPixels.length}, expected=${expectedLen}`);
            }

            let rgbaPixels: Uint8Array;

            // 2) 转 RGBA
            if (format === 'bgr') {
              rgbaPixels = new Uint8Array(width * height * 4);
              // BGR(3) -> RGBA(4)
              for (let i = 0; i < width * height; i++) {
                const srcIdx = i * 3;
                const dstIdx = i * 4;
                rgbaPixels[dstIdx + 0] = srcPixels[srcIdx + 2]; // R
                rgbaPixels[dstIdx + 1] = srcPixels[srcIdx + 1]; // G
                rgbaPixels[dstIdx + 2] = srcPixels[srcIdx + 0]; // B
                rgbaPixels[dstIdx + 3] = 255;                   // A
              }
            } else {
              // rgba：直接用（可拷贝一份更保险）
              rgbaPixels = srcPixels;
              // rgbaPixels = new Uint8Array(srcPixels.buffer.slice(0, expectedLen));
            }

            // 3) 创建 Skia Image
            const imageInfo = {
              width,
              height,
              colorType: ColorType.RGBA_8888,
              alphaType: AlphaType.Opaque, // 你这里 A 要么 255，要么仍然可以写 Premul；Opaque 最快
            };

            const img = Skia.Image.MakeImage(imageInfo, Skia.Data.fromBytes(rgbaPixels), width * 4);
            if (!img) throw new Error('Skia.Image.MakeImage 失败');

            // 4) 编码保存
            const b64 = img.encodeToBase64(ImageFormat.JPEG, 90);
            const path = `${RNFS.CachesDirectoryPath}/face_${Date.now()}.jpg`;
            await RNFS.writeFile(path, b64, 'base64');

            console.log('--- 抓拍成功 --- 路径:', path);
          } catch (e: any) {
            console.error('JS线程: 保存流程发生错误:', e?.message ?? e);
          } finally {
            setIsSaving(false);
          }
        }
      ),
    []
  );



  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';


      try {
        runAtTargetFps(frameProcessorFps, () => {
          'worklet';

          const unboxed = BoxedInspireFace.unbox();
          const isFront = cameraType === 'front';

          let isMirrored = frame.isMirrored;
          let orientation = frame.orientation;
          let pixelFormat = frame.pixelFormat;
          let widthFrame = frame.width;
          let heightFrame = frame.height;

          let rotDegress = getFrameRotationDegrees(frame);
          let rotDegressCamera = toCameraRotation(rotDegress);
          // 反向旋转来纠正图像
          let rotationResized: string = rotDegress === 90 ? '270deg' : rotDegress === 180 ? '180deg' : rotDegress === 270 ? '90deg' : '0deg';
          // 根据旋转角度调整宽高尺寸
          let adjustedWidth = widthFrame;
          let adjustedHeight = heightFrame;
          if (rotDegress === 90 || rotDegress === 270) {
            // 90度或270度旋转时，宽高需要调换
            adjustedWidth = heightFrame;
            adjustedHeight = widthFrame;
          }
          let pixelFormatResized = 'bgr'; // 'rgba'
          console.log(`isFront=${isFront}, isMirrored=${isMirrored}, orientation=${orientation}, rotDegress=${rotDegress}, rotationResized=${rotationResized}, rotDegressCamera=${rotDegressCamera}, pixelFormat=${pixelFormat}, width=${widthFrame}, height=${heightFrame}, adjustedWidth=${adjustedWidth}, adjustedHeight=${adjustedHeight}`);
          // 2. 调整图像，把图正过来
          const resizedFrame = resize(frame, {
            scale: {width: adjustedWidth, height: adjustedHeight},
            rotation: rotationResized,
            pixelFormat: pixelFormatResized,
            dataType: 'uint8',
            mirror: isFront,
          });
          const bufferFrame = resizedFrame.buffer;
          const base64 = unboxed.toBase64(bufferFrame);
          saveImage({
            base64: base64,
            width: widthFrame,
            height: heightFrame,
            format: pixelFormatResized,
          });

          let bitmap: any = null;
          let imageStream: any = null;


          try {
            // ✅ resize 只做缩放，不旋转不镜像（保证 SDK 识别稳定）
            const resized = resize(frame, {
              scale: {width: SRC_W, height: SRC_H},
              rotation: '0deg',
              pixelFormat: 'bgr',
              dataType: 'uint8',
              mirror: false,
            });

            if (!resized?.buffer) {
              reportFacesToJS({
                faceCount: 0,
                rotDeg: 0,
                mode: 0,
                anchor: 0,
                coordW: SRC_W,
                coordH: SRC_H,
                faces: [],
                isFrontCamera: isFront
              });
              return;
            }

            const rotDeg = getFrameRotationDegrees(frame);
            const camRot = toCameraRotation(rotDeg);

            const upright = uprightSizeForRotation(rotDeg);
            const uprightW = upright.w;
            const uprightH = upright.h;


            // 2. 抓拍逻辑
            console.log("1shouldCapture.value=" + shouldCapture.value)
            if (shouldCapture.value) {
              shouldCapture.value = false;
              console.log("2shouldCapture.value=" + shouldCapture.value)
              const resized2 = resize(frame, {
                scale: {width: SRC_W, height: SRC_H},
                pixelFormat: 'bgr', // 建议 BGR，因为 InspireFace C++ 端对 BGR 支持最好
                dataType: 'uint8',
              });

              if (resized2 && resized2.buffer) {
                console.log("resized2=" + resized2.buffer.byteLength)
                const base64 = unboxed.toBase64(resized2.buffer);
                saveImage({
                  base64: base64,
                  width: SRC_W,
                  height: SRC_H,
                  format: 'bgr',
                });
              }
            }

            bitmap = unboxed.createImageBitmapFromBuffer(resized.buffer as ArrayBuffer, SRC_W, SRC_H, 3);
            imageStream = unboxed.createImageStreamFromBitmap(bitmap, camRot);

            const session = boxedSession.unbox();
            if (!session) {
              reportFacesToJS({
                faceCount: 0,
                rotDeg,
                mode: 0,
                anchor: 0,
                coordW: uprightW,
                coordH: uprightH,
                faces: [],
                isFrontCamera: isFront
              });
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
              reportFacesToJS({
                faceCount: 0,
                rotDeg,
                mode: 0,
                anchor: 0,
                coordW: uprightW,
                coordH: uprightH,
                faces: [],
                isFrontCamera: isFront
              });
              return;
            }

            // ✅ 画框坐标系统一使用 uprightW/uprightH（后续 JS 会自动映射到 video/preview）
            const coordW = uprightW;
            const coordH = uprightH;

            // ✅ 镜像只发生一次：看顶部开关
            const mirrorUI = isFront && MIRROR_ON_OVERLAY;
            const out: FaceBoxBuf[] = [];

            // 移除全局的chosenMode和chosenAnchor变量
            // let chosenMode = 0;
            // let chosenAnchor = 0;

            // 在for循环内部为每个人脸计算独立的转换参数
            for (let i = 0; i < faceCount; i++) {
              const f = facesAny[i] ?? {
                token: facesAny.tokens?.[i],
                rect: facesAny.rects?.[i],
                trackId: facesAny.trackIds?.[i] ?? facesAny.ids?.[i],
              };
              if (!f?.rect || !f?.token) continue;
              console.log("rect=" + JSON.stringify(f.rect))

              // 获取人脸关键点
              // val facePoints = unboxed.getFaceDenseLandmarkFromFaceToken(f.token)


              const rawBase = normalizeRectToPx(f.rect, SRC_W, SRC_H);

              // ✅ 为每个人脸智能转换base rect到upright rect
              const smart = baseRectToUprightSmart(rawBase, rotDeg, uprightW, uprightH);

              // 不再只为第一张脸设置转换参数，每个人脸都有自己的mode和anchor
              // if (i === 0) {
              //   chosenMode = smart.mode;
              //   chosenAnchor = smart.anchor ?? 0;
              // }

              let rU = smart; // x/y/width/height/outW/outH

              if (SDK_Y_ORIGIN_BOTTOM) {
                rU = {...rU, y: rU.outH - (rU.y + rU.height)};
              }

              if (mirrorUI) {
                rU = {...rU, x: rU.outW - (rU.x + rU.width)};
              }

              const bx = clamp(rU.x, -rU.outW, rU.outW * 2);
              const by = clamp(rU.y, -rU.outH, rU.outH * 2);
              const bw = clamp(rU.width, 0, rU.outW * 2);
              const bh = clamp(rU.height, 0, rU.outH * 2);

              let searched: any = null;
              try {
                const feature = session.extractFaceFeature(imageStream, f.token);
                searched = unboxed.featureHubFaceSearch(feature);
                // console.info('识别成功:', searched.id, '置信度:', searched.confidence);
              } catch (error: Error) {
                console.error('特征提取或识别失败:', error.message);
              }

              const confidence = searched?.confidence || 0;
              const isMatched = !!(searched?.id && confidence > confidenceThreshold);

              out.push({
                x: bx,
                y: by,
                width: bw,
                height: bh,
                trackId: Number(i + 1),
                hubId: searched?.id || -1,
                name: '',
                confidence,
                isMatched,
                mode: smart.mode,  // 添加：存储每个人脸的转换模式
                anchor: smart.anchor,  // 添加：存储每个人脸的转换锚点
              });
            }

            reportFacesToJS({
              faceCount,
              rotDeg,
              // 不再使用全局的转换参数
              // mode: chosenMode,
              // anchor: chosenAnchor,
              coordW,
              coordH,
              faces: out,
              isFrontCamera: isFront,
            });
          } catch {
            reportFacesToJS({
              faceCount: 0,
              rotDeg: 0,
              mode: 0,
              anchor: 0,
              coordW: SRC_W,
              coordH: SRC_H,
              faces: [],
              isFrontCamera: isFront
            });
          } finally {
            try {
              if (imageStream) imageStream.dispose();
            } catch {
            }
            try {
              if (bitmap) bitmap.dispose();
            } catch {
            }
          }
        });
      } finally {

      }
    },
    [resize, boxedSession, reportFacesToJS, cameraType, frameProcessorFps, confidenceThreshold, saveImage, shouldCapture]
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
        <ActivityIndicator size="large" color="#ffffff"/>
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
        frameProcessor={frameProcessor}
        resizeMode={CURRENT_RESIZE_MODE} // 使用统一的 resizeMode
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
          // 确保这里的 size.height 是 Canvas 实际占用的物理像素高度
          if (canvasSize.value.height !== size.height) {
            canvasSize.value = size;
          }
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
              <Rect x={bgX} y={bgY} width={textW} height={textH} color={bgColor}/>
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
            <Rect x={10} y={40} width={760} height={78} color={BG_BLACK50}/>
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
              text={`base:${debug.base} coord:${debug.coord}`}
              font={font}
              color={COLOR_WHITE}
            />
            <SkiaText
              x={20}
              y={108}
              text={`video:${debug.video}`}
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
        {/* 4. 增加拍照按钮 */}
        <TouchableOpacity
          style={[styles.button, {backgroundColor: 'gold'}]}
          onPress={() => {
            shouldCapture.value = true;
          }}
          disabled={isSaving}
        >
          <Text style={{color: 'black'}}>{isSaving ? '保存中...' : '抓拍'}</Text>
        </TouchableOpacity>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'black'},
  text: {color: 'white', fontSize: 16, marginTop: 10},
  linkText: {color: '#007AFF', fontSize: 16, marginTop: 10},
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
  buttonText: {color: 'white', fontSize: 16, fontWeight: 'bold'},
  primaryButton: {backgroundColor: 'rgba(0, 122, 255, 0.8)'},
  dangerButton: {backgroundColor: 'rgba(255, 59, 48, 0.8)'},
});
