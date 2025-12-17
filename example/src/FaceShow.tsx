import 'react-native-worklets-core';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  BoxedInspireFace,
  CameraRotation,
  DetectMode,
  InspireFace,
  type FaceData,
} from 'react-native-nitro-inspire-face';
import { NitroModules } from 'react-native-nitro-modules';

import {
  Camera,
  Templates,
  useCameraDevice,
  useCameraFormat,
  useFrameProcessor,
  runAtTargetFps,
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

// ✅ Skia 2.2.12：用 Canvas + Rect + Text（不要用 PaintStyle/MakeDefault）
import {
  Canvas,
  Rect,
  Text as SkiaText,
  useFont,
} from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';
import { MMKV } from 'react-native-mmkv';

// 初始化 MMKV
const storage = new MMKV({
  id: 'user-faces-storage',
});
// Launch the model package
InspireFace.launch('Pikachu');

const { width: WIN_W } = Dimensions.get('window');
const PREVIEW_W = WIN_W;
const PREVIEW_H = WIN_W * (16 / 9);

// 如果识别结果里拿不到姓名，可以维护映射（示例）
const NAME_BY_ID: Record<number, string> = {
  1: '张三',
  2: '李四',
};

function getCameraPermissionConst() {
  return Platform.select({
    ios: PERMISSIONS.IOS.CAMERA,
    android: PERMISSIONS.ANDROID.CAMERA,
    default: PERMISSIONS.ANDROID.CAMERA,
  });
}

// worklet：轻量节流日志
function shouldLog(ts: number) {
  'worklet';
  return Math.floor(ts / 1e9) % 1 === 0 && ts % 1e9 < 2e7;
}

type FaceBoxUI = {
  x: number;
  y: number;
  width: number;
  height: number;
  id: number; // 这里用 trackId，当作识别 id（你可替换成 personId）
  name?: string;
  confidence?: number; // 添加置信度字段
  isMatched?: boolean; // 添加匹配状态字段
};

type FaceBoxBuf = {
  x: number;
  y: number;
  width: number;
  height: number;
  trackId: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * 把“buffer 坐标(landscape)”映射到“屏幕 Canvas 坐标(portrait)”。
 * 处理：
 * 1) 先按 90°旋转（landscape -> portrait）
 * 2) 再按 Camera 的 cover 规则缩放/裁切
 * 3) 前置镜像（mirror）
 */
function mapBufRectToView(
  b: FaceBoxBuf,
  frameW: number,
  frameH: number,
  viewW: number,
  viewH: number,
  mirror: boolean
) {
  // rotated buffer size (portrait)
  const rotatedW = frameH;
  const rotatedH = frameW;

  // rotate clockwise:
  // x' = y
  // y' = frameW - (x + w)
  // w' = h
  // h' = w
  const xP = b.y;
  const yP = frameW - (b.x + b.width);
  const wP = b.height;
  const hP = b.width;

  // cover scaling (same behavior as resizeMode="cover")
  const scale = Math.max(viewW / rotatedW, viewH / rotatedH);
  const scaledW = rotatedW * scale;
  const scaledH = rotatedH * scale;
  const offsetX = (viewW - scaledW) / 2;
  const offsetY = (viewH - scaledH) / 2;

  let x = xP * scale + offsetX;
  let y = yP * scale + offsetY;
  let w = wP * scale;
  let h = hP * scale;

  if (mirror) {
    x = viewW - (x + w);
  }

  // 最后做一下边界保护
  x = clamp(x, -viewW, viewW * 2);
  y = clamp(y, -viewH, viewH * 2);
  w = clamp(w, 0, viewW * 2);
  h = clamp(h, 0, viewH * 2);

  return { x, y, width: w, height: h };
}

export default function Example() {
  const device = useCameraDevice('front');
  const camera = useRef<Camera>(null);
  const { resize } = useResizePlugin();
  const [registeredFaces, setRegisteredFaces] = useState<FaceData[]>([]);

  // 注意：有些版本 useCameraFormat 对 device=null 也能工作；这里保持你原写法
  const format = useCameraFormat(device, Templates.FrameProcessing);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // ✅ Canvas size：用 onSize（避免新架构 Canvas onLayout 警告）
  const canvasSize = useSharedValue({ width: PREVIEW_W, height: PREVIEW_H });

  // ✅ 字体：请换成你项目里真实存在的字体文件（建议带中文）
  // Android 可以放到 assets/fonts/ 之类
  const font = useFont(require('./assets/fonts/PingFangSC-Regular.ttf'), 18);

  // JS state：Canvas 用它来画框
  const [boxes, setBoxes] = useState<FaceBoxUI[]>([]);

  // ====== 权限：react-native-permissions ======
  useEffect(() => {
    (async () => {
      const perm = getCameraPermissionConst();
      if (!perm) {
        setHasPermission(false);
        return;
      }

      const st0 = await check(perm);
      if (st0 === RESULTS.GRANTED || st0 === RESULTS.LIMITED) {
        setHasPermission(true);
        return;
      }

      const st1 = await request(perm);
      setHasPermission(st1 === RESULTS.GRANTED || st1 === RESULTS.LIMITED);

      // 应用启动时加载持久化数据
      const jsonString = storage.getString('registeredFaces');
      if (jsonString) {
        setRegisteredFaces(JSON.parse(jsonString));
      }
    })();
  }, []);

  // ✅ Session 只创建一次，并 box 起来让 worklet 可用
  const boxedSession = useMemo(() => {
    const s = InspireFace.createSession(
      {
        enableRecognition: true,
        enableFaceQuality: true,
        enableFaceAttribute: true,
        enableInteractionLiveness: true,
        enableLiveness: true,
        enableMaskDetect: true,
      },
      DetectMode.ALWAYS_DETECT,
      10,
      -1,
      -1
    );
    s.setTrackPreviewSize(320);
    s.setFaceDetectThreshold(0.5);
    return NitroModules.box(s);
  }, []);

  // ✅ 用 Worklets.createRunOnJS 回 JS 更新 boxes（不要在 frameProcessor 里直接 setState）
  const reportFacesToJS = useMemo(() => {
    return Worklets.createRunOnJS(
      (payload: { frameW: number; frameH: number; faces: FaceBoxBuf[] }) => {
        const { frameW, frameH, faces } = payload;

        // 前置镜像：你 resize 里 mirror:true，这里也镜像一次保证和预览一致
        const mirror = true;

        const next = faces.map((b) => {
          const mapped = mapBufRectToView(
            b,
            frameW,
            frameH,
            PREVIEW_W,
            PREVIEW_H,
            mirror
          );

          const id = b.trackId; // ✅ 先用 trackId；你有 personId 时替换这里
          const name = NAME_BY_ID[id] ?? '';

          return {
            ...mapped,
            id,
            name,
            // 传递置信度和匹配状态到UI层
            confidence: b.confidence,
            isMatched: b.isMatched,
          };
        });

        setBoxes(next);
      }
    );
  }, []);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      runAtTargetFps(15, () => {
        'worklet';

        const size = 320;

        // 你之前的换算逻辑保留：square(320) -> buffer(landscape)
        const frameWidth = frame.height; // 你原逻辑：拿 height 当“可视宽”
        const scaleX = frameWidth / size;
        const cropOffset = (frame.width - frame.height) / 2;

        let bitmap: any = null;
        let imageStream: any = null;

        try {
          const resized = resize(frame, {
            scale: { width: size, height: size },
            rotation: '90deg',
            pixelFormat: 'bgr',
            dataType: 'uint8',
            mirror: true,
          });

          const unboxedInspireFace = BoxedInspireFace.unbox();
          bitmap = unboxedInspireFace.createImageBitmapFromBuffer(
            resized.buffer as ArrayBuffer,
            size,
            size,
            3
          );
          imageStream = unboxedInspireFace.createImageStreamFromBitmap(
            bitmap,
            CameraRotation.ROTATION_0
          );

          const session = boxedSession.unbox();
          const faces: FaceData[] = session.executeFaceTrack(imageStream);

          if (shouldLog(frame.timestamp)) {
            console.log(
              '[Worklet] faces.length =',
              Array.isArray(faces) ? faces.length : -1
            );
          }

          const out: FaceBoxBuf[] = [];

          if (Array.isArray(faces)) {
            for (let i = 0; i < faces.length; i++) {
              const f = faces[i];
              if (!f) continue;
              const r = f.rect;
              if (!r) continue;
              const feature = session.extractFaceFeature(imageStream, f.token);
              const searched =
                unboxedInspireFace.featureHubFaceSearch(feature);
              let name = 'Unknown';
              let resultText = '';
              let confidence = 0;
              let isMatched = false;

              if (
                searched &&
                searched.confidence &&
                searched.confidence > 0.6
              ) {
                const registeredFace = registeredFaces.find(
                  (face) => face.id === searched.id
                );
                if (registeredFace) {
                  //识别成功
                  name = registeredFace.name;
                  resultText = `识别到：${name} (${(
                    searched.confidence * 100
                  ).toFixed(1)}%)`;
                  confidence = searched.confidence;
                  isMatched = true;
                }
              }
              // 兼容：rect 可能是 0~1 归一化，也可能是 0~320 像素
              let rx = Number(r.x ?? 0);
              let ry = Number(r.y ?? 0);
              let rw = Number(r.width ?? 0);
              let rh = Number(r.height ?? 0);

              if (rw <= 1.5 && rh <= 1.5) {
                rx *= size;
                ry *= size;
                rw *= size;
                rh *= size;
              }

              // 你 landmarks 的逻辑是 point.y -> x，point.x -> y
              // rect 同样做 swap
              const xBuf = ry * scaleX + cropOffset;
              const yBuf = rx * scaleX;
              const wBuf = rh * scaleX;
              const hBuf = rw * scaleX;

              out.push({
                x: xBuf,
                y: yBuf,
                width: wBuf,
                height: hBuf,
                trackId: Number(f.trackId ?? 0),
                // 添加置信度和匹配状态信息
                confidence: confidence,
                isMatched: isMatched,
              });
            }
          }

          // ✅ 回 JS 更新 Canvas 框
          reportFacesToJS({
            frameW: frame.width,
            frameH: frame.height,
            faces: out,
          });
        } catch (e: any) {
          console.error('[Worklet] FaceTrack crash:', e?.message ?? e);
        } finally {
          try {
            imageStream?.dispose?.();
          } catch {}
          try {
            bitmap?.dispose?.();
          } catch {}
        }
      });
    },
    [resize, boxedSession, reportFacesToJS, registeredFaces]
  );

  // ===== UI 状态 =====
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
        <Text style={styles.text}>
          Camera permission not granted (or blocked).
        </Text>
        <Text
          style={[styles.text, { marginTop: 12 }]}
          onPress={() => openSettings()}
        >
          Open Settings
        </Text>
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

  // ===== 主界面 =====
  return (
    <View style={styles.view}>
      <Camera
        ref={camera}
        style={[
          StyleSheet.absoluteFill,
          { width: PREVIEW_W, height: PREVIEW_H },
        ]}
        device={device}
        isActive={true}
        format={format}
        frameProcessor={frameProcessor}
        resizeMode="cover"
      />

      {/* ✅ Canvas 叠加层（SkiaDemoScreen 的方式） */}
      <Canvas
        style={[
          StyleSheet.absoluteFill,
          { width: PREVIEW_W, height: PREVIEW_H },
        ]}
        onSize={canvasSize}
      >
        {boxes.map((b) => {
          // 构造显示标签：如果有人名则显示ID和姓名，否则只显示ID
          // 如果有置信度信息，则添加到标签中
          let label = b.name ? `ID:${b.id}  ${b.name}` : `ID:${b.id}`;
          if (b.confidence !== undefined) {
            label += ` (${(b.confidence * 100).toFixed(1)}%)`;
          }

          // 根据匹配状态确定颜色：绿色表示匹配，红色表示未匹配
          const boxColor = b.isMatched ? "#00FF00" : "#FF0000";
          const bgColor = b.isMatched ? "rgba(0,255,0,0.85)" : "rgba(255,0,0,0.85)";
          const textColor = b.isMatched ? "#000000" : "#FFFFFF";

          // 计算标签背景的尺寸
          const padX = 6;
          const padY = 4;
          const textW = font ? font.getTextWidth(label) + padX * 2 : 120;
          const textH = font ? font.getSize() + padY * 2 + 6 : 24;

          // 计算标签背景的位置（在人脸框上方）
          const bgX = b.x;
          const bgY = Math.max(0, b.y - textH - 6);

          return (
            <React.Fragment
              key={`${b.id}-${Math.round(b.x)}-${Math.round(b.y)}`}
            >
              {/* 绘制人脸框（根据匹配状态显示不同颜色） */}
              <Rect
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                color={boxColor}
                style="stroke"
                strokeWidth={3}
              />

              {/* 绘制标签背景（根据匹配状态显示不同颜色） */}
              <Rect
                x={bgX}
                y={bgY}
                width={textW}
                height={textH}
                color={bgColor}
              />

              {/* 绘制标签文字（根据匹配状态显示不同颜色） */}
              {font ? (
                <SkiaText
                  x={bgX + padX}
                  y={bgY + textH - padY - 4}
                  text={label}
                  font={font}
                  color={textColor}
                />
              ) : null}
            </React.Fragment>
          );
        })}

        {/* 显示已注册人数 */}
        {font && (
          <React.Fragment>
            <Rect
              x={PREVIEW_W - 160}
              y={20}
              width={150}
              height={30}
              color="rgba(0,0,0,0.5)"
            />
            <SkiaText
              x={PREVIEW_W - 150}
              y={45}
              text={`已注册人数: ${registeredFaces.length}`}
              font={font}
              color="#FFFFFF"
            />
          </React.Fragment>
        )}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
  text: { color: 'white', fontSize: 16, marginTop: 10 },
  view: { flex: 1, backgroundColor: 'black' },
});
