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
  useWindowDimensions,
} from 'react-native';
import {useFocusEffect, useIsFocused} from '@react-navigation/native';

import {
  BoxedInspireFace,
  CameraRotation,
  DetectMode, type FaceData, type ImageBitmap,
  InspireFace, type Session,
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

function normalizeRectToPx(rect: any, W: number, H: number) {
  'worklet';
  let x = Number(rect?.x ?? 0);
  let y = Number(rect?.y ?? 0);
  let w = Number(rect?.width ?? 0);
  let h = Number(rect?.height ?? 0);
  return {x, y, width: w, height: h};
}

/**
 * ✅ 核心：rect(coordW/coordH) -> view(contain/cover)
 * 这里 coordW/coordH 是识别坐标系（固定 320x320）
 */
function mapRectToView(
  b: { x: number; y: number; width: number; height: number },
  coordW: number, // 识别坐标系宽（320）
  coordH: number, // 识别坐标系高（320）
  viewW: number,  // Canvas 宽
  viewH: number,  // Canvas 高
  resizeMode: string
) {
  'worklet';

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (resizeMode === 'cover') {
    scale = Math.max(viewW / coordW, viewH / coordH);
  } else {
    scale = Math.min(viewW / coordW, viewH / coordH);
  }

  offsetX = (viewW - coordW * scale) / 2;
  offsetY = (viewH - coordH * scale) / 2;

  return {
    x: b.x * scale + offsetX,
    y: b.y * scale + offsetY,
    width: b.width * scale,
    height: b.height * scale,
  };
}

// ===================== Format helper（不固定比例） =====================
function pickBestFormat(device: any) {
  if (!device?.formats?.length) return undefined;
  let best = device.formats[0];
  let bestScore = -1e18;

  for (const f of device.formats) {
    const w = Number(f.videoWidth ?? 0);
    const h = Number(f.videoHeight ?? 0);
    const fps = Number(f.maxFps ?? 30);
    const area = w * h;

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
  const { width: screenW, height: screenH } = useWindowDimensions();
  // 80% 给 cameraView，20% 给 showView
  const cameraH = Math.round(screenH * 0.8);
  // cameraView 宽度用屏幕实际宽度（不写 100%）
  const cameraW = Math.round(screenW);
  const showH = Math.max(0, screenH - cameraH);

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
    base: `320x320`,
    coord: `0x0`,
    video: `0x0`,
    frame: `0x0`,
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
    s.setTrackPreviewSize(320); // ✅ 识别输入固定 320x320
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
        frameW: number;
        frameH: number;
        faces: FaceBoxBuf[];
        isFrontCamera: boolean;
      }) => {
        const now = Date.now();
        if (now - lastReportTime < 66) return;
        lastReportTime = now;

        const vw = canvasSize.value?.width || PREVIEW_W;
        const vh = canvasSize.value?.height || PREVIEW_H;

        setDebug({
          faceCount: payload.faceCount,
          rotDeg: payload.rotDeg,
          mode: payload.mode,
          anchor: payload.anchor,
          base: `320x320`,
          coord: `${payload.coordW}x${payload.coordH}`,
          frame: `${payload.frameW}x${payload.frameH}`,
          video: `${vw}x${vh}`,
        });

        const alpha = 0.75;

        const next: FaceBoxUI[] = payload.faces.map((b) => {
          // ✅ b 是 320x320 坐标，按比例还原到 Canvas
          // 1) 320x320 rect -> frame 坐标系 rect（frameW x frameH）
          const sx = payload.frameW / payload.coordW;
          const sy = payload.frameH / payload.coordH;

          const bFrame = {
            x: b.x * sx,
            y: b.y * sy,
            width: b.width * sx,
            height: b.height * sy,
          };

          // 2) frame rect -> Canvas 像素坐标（cover/contain）
          const mapped = mapRectToView(
            bFrame,
            payload.frameW,
            payload.frameH,
            vw,
            vh,
            CURRENT_RESIZE_MODE
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
              rgbaPixels = srcPixels;
            }

            // 3) 创建 Skia Image
            const imageInfo = {
              width,
              height,
              colorType: ColorType.RGBA_8888,
              alphaType: AlphaType.Opaque,
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

  function getDisplayFrameSize(frame: Frame,rotation: number) {
    'worklet';
    const w = frame.width;
    const h = frame.height;
    const r = rotation; // VisionCamera 通常是 0/90/180/270

    if (r === 90 || r === 270) return { w: h, h: w };
    return { w, h };
  }


  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';

      try {
        runAtTargetFps(frameProcessorFps, () => {
          'worklet';

          const unboxed = BoxedInspireFace.unbox();
          const isFront = cameraType === 'front';

          let rotDegress = getFrameRotationDegrees(frame);
          const { w: frameW, h: frameH } = getDisplayFrameSize(frame,rotDegress);
          // 反向旋转来纠正图像（让 resized 和预览一致）
          let rotationResized: string =
            rotDegress === 90 ? '270deg' :
              rotDegress === 180 ? '180deg' :
                rotDegress === 270 ? '90deg' : '0deg';

          let pixelFormatResized: 'bgr' | 'rgba' = 'bgr';
          const scaleSize = 320;
          console.log(`JS线程: 原始尺寸 ${frameW}x${frameH}, 旋转角度 ${rotDegress}, 缩放尺寸 ${scaleSize}x${scaleSize}, 像素格式 ${pixelFormatResized}`);

          let bitmap: any = null;
          let imageStream: any = null;

          try {
            // ✅ 识别输入：固定 320x320（正方形），并且 rotation+mirror 后就是“正确视角”
            const resized = resize(frame, {
              scale: {width: scaleSize, height: scaleSize},
              rotation: rotationResized,
              pixelFormat: pixelFormatResized,
              dataType: 'uint8',
              mirror: isFront,
            });

            if (!resized?.buffer) {
              reportFacesToJS({
                faceCount: 0,
                rotDeg: rotDegress,
                mode: 0,
                anchor: 0,
                coordW: scaleSize,
                coordH: scaleSize,
                frameW: frameW,
                frameH: frameH,
                faces: [],
                isFrontCamera: isFront
              });
              return;
            }

            const rotDeg = getFrameRotationDegrees(frame);
            const coordW = scaleSize;
            const coordH = scaleSize;

            // 2) 抓拍逻辑（保存 320x320）
            if (shouldCapture.value) {
              shouldCapture.value = false;

              const resized2 = resize(frame, {
                scale: {width: scaleSize, height: scaleSize},
                rotation: rotationResized,
                pixelFormat: pixelFormatResized,
                dataType: 'uint8',
                mirror: isFront,
              });

              if (resized2 && resized2.buffer) {
                const base64 = unboxed.toBase64(resized2.buffer);
                saveImage({
                  base64: base64,
                  width: scaleSize,
                  height: scaleSize,
                  format: pixelFormatResized,
                });
              }
            }

            // ✅ 注意：bitmap/imageStream 也必须使用 320x320，并且 ROTATION_0（因为我们已经旋转纠正过）
            bitmap = unboxed.createImageBitmapFromBuffer(resized.buffer as ArrayBuffer, scaleSize, scaleSize, 3);
            imageStream = unboxed.createImageStreamFromBitmap(bitmap, CameraRotation.ROTATION_0);

            const session: Session = boxedSession.unbox();
            //提取面部特征
            const faceList: FaceData[] = session.executeFaceTrack(imageStream);

            const faceCount = faceList.length;
            if (faceCount <= 0) {
              reportFacesToJS({
                faceCount: 0,
                rotDeg,
                mode: 0,
                anchor: 0,
                coordW: coordW,
                coordH: coordH,
                frameW: frameW,
                frameH: frameH,
                faces: [],
                isFrontCamera: isFront
              });
              return;
            }

            // ✅ 画框坐标系：识别输入就是 320x320（resized），facesAny.rects 也是这个坐标系
            // ✅ 镜像只发生一次：预览镜像时，overlay 不镜像；否则这里镜像
            const mirrorUI = isFront && MIRROR_ON_OVERLAY;
            const out: FaceBoxBuf[] = [];
            for (let face of faceList) {
              // 获取人脸关键点
              console.log('face.trackId', face.trackId);
              console.log('face.rect', JSON.stringify(face.rect));
              // const facePoints = unboxed.getFaceDenseLandmarkFromFaceToken(face.token);
              // console.log('facePoints', JSON.stringify(facePoints));
              // rect 已经是“正确视角”的 320x320 坐标（因为 resized 已 rotation+mirror）
              const r0 = normalizeRectToPx(face.rect, coordW, coordH);

              let rU: any = { ...r0, outW: coordW, outH: coordH };

              // 极少数机型 y 原点在左下角才需要
              if (SDK_Y_ORIGIN_BOTTOM) {
                rU = { ...rU, y: rU.outH - (rU.y + rU.height) };
              }

              // 如果 overlay 需要镜像，在 320x320 坐标系里做一次镜像
              if (mirrorUI) {
                rU = { ...rU, x: rU.outW - (rU.x + rU.width) };
              }

              const bx = clamp(rU.x, -rU.outW, rU.outW * 2);
              const by = clamp(rU.y, -rU.outH, rU.outH * 2);
              const bw = clamp(rU.width, 0, rU.outW * 2);
              const bh = clamp(rU.height, 0, rU.outH * 2);

              let searched: any = null;
              try {
                //提取面部特征
                const feature = session.extractFaceFeature(imageStream, face.token);
                searched = unboxed.featureHubFaceSearch(feature);
              } catch (error: any) {
                console.error('特征提取或识别失败:', error?.message ?? error);
              }

              const confidence = searched?.confidence || 0;
              const isMatched = !!(searched?.id && confidence > confidenceThreshold);

              out.push({
                x: bx,
                y: by,
                width: bw,
                height: bh,
                trackId: face.trackId,
                hubId: searched?.id || -1,
                name: '',
                confidence,
                isMatched,
                mode: 0,
                anchor: 0,
              });
            }

            reportFacesToJS({
              faceCount,
              rotDeg,
              mode: 0,
              anchor: 0,
              coordW,
              coordH,
              frameW: frameW,
              frameH: frameH,
              faces: out,
              isFrontCamera: isFront,
            });
          } catch {
            reportFacesToJS({
              faceCount: 0,
              rotDeg: 0,
              mode: 0,
              anchor: 0,
              coordW: 320,
              coordH: 320,
              frameW: frameW,
              frameH: frameH,
              faces: [],
              isFrontCamera: isFront
            });
          } finally {
            try {
              if (imageStream) imageStream.dispose();
            } catch {}
            try {
              if (bitmap) bitmap.dispose();
            } catch {}
          }
        });
      } finally {}
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
    <View id="full" style={styles.full}>
      <View id="cameraview" style={[styles.cameraView, { width: cameraW, height: cameraH }]}>
        <Camera
          ref={camera}
          style={[StyleSheet.absoluteFill, { width: cameraW, height: cameraH }]}
          device={device}
          isActive={isFocused && cameraInitialized && isCameraActive}
          frameProcessor={frameProcessor}
          resizeMode={CURRENT_RESIZE_MODE}
          zoom={0}
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
            // Canvas 实际尺寸（用于把 320x320 坐标还原到屏幕）
            if (canvasSize.value.width !== size.width || canvasSize.value.height !== size.height) {
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
                text={`hub:${hubFaceCount} faces:${debug.faceCount} rot:${debug.rotDeg}`}
                font={font}
                color={COLOR_WHITE}
              />
              <SkiaText
                x={20}
                y={88}
                text={`coord:${debug.coord} canvas:${debug.video}`}
                font={font}
                color={COLOR_WHITE}
              />
              <SkiaText
                x={20}
                y={108}
                text={`frame:${debug.frame}`}
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

          <TouchableOpacity
            style={[styles.button, {backgroundColor: 'gold'}]}
            onPress={() => { shouldCapture.value = true; }}
            disabled={isSaving}
          >
            <Text style={{color: 'black'}}>{isSaving ? '保存中...' : '抓拍'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View id="showview" style={[styles.showView, { width: cameraW, height: showH }]}>
        {/* 这里放你的 showview 内容 */}
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

  full: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: 'black',
  },
  cameraView: {
    // 尺寸由外层 inline style 传入（按屏幕实际宽高计算）
    backgroundColor: 'black',
  },
  showView: {
    // 尺寸由外层 inline style 传入
    backgroundColor: '#111', // 你想要啥背景自己改
  },
});
