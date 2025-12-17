import React, { useEffect, useMemo, useRef, useState } from "react";
import {ActivityIndicator, Dimensions, Platform, StyleSheet, Text, View} from "react-native";
import {
  BoxedInspireFace,
  CameraRotation,
  DetectMode,
  InspireFace,
  type FaceData,
  type Point2f,
} from "react-native-nitro-inspire-face";
import { NitroModules } from "react-native-nitro-modules";
import {
  Camera,
  Templates,
  useCameraDevice,
  useCameraFormat, useFrameProcessor,
  useSkiaFrameProcessor,
} from "react-native-vision-camera";
import { useResizePlugin } from "vision-camera-resize-plugin";
import { check, request, openSettings, PERMISSIONS, RESULTS } from "react-native-permissions";

// ✅ Skia 2.2.12：用 useFont，不要用 Typeface.MakeDefault()
import {Canvas, Rect, Skia, useFont} from "@shopify/react-native-skia";

// Launch the model package
InspireFace.launch("Pikachu");


// 常量
const { width } = Dimensions.get('window');
const PREVIEW_W = width;
const PREVIEW_H = width * (16 / 9); // 使用常见的 16:9 宽高比


const NAME_BY_ID: Record<number, string> = {
  1: "张三",
  2: "李四",
};

// 日志节流：大概每 1s 打一次（避免刷屏卡顿）
function shouldLog(ts: number) {
  "worklet";
  return (Math.floor(ts / 1e9) % 1) === 0 && (ts % 1e9) < 2e7;
}

function getCameraPermissionConst() {
  return Platform.select({
    ios: PERMISSIONS.IOS.CAMERA,
    android: PERMISSIONS.ANDROID.CAMERA,
    default: PERMISSIONS.ANDROID.CAMERA,
  });
}

export default function Example() {
  const device = useCameraDevice("front");
  const camera = useRef<Camera>(null);
  const { resize } = useResizePlugin();
  const format = useCameraFormat(device, Templates.FrameProcessing);

  // ✅ hasPermission 要允许 null（请求中）
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // ✅ 字体：请放一个 ttf 到你的项目里（路径自己改）
  const font = useFont(require("./assets/fonts/PingFangSC-Regular.ttf"), 18);

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

      if (st1 === RESULTS.BLOCKED) {
        setHasPermission(false);
        return;
      }
      setHasPermission(st1 === RESULTS.GRANTED || st1 === RESULTS.LIMITED);
    })();
  }, []);

  // ✅ Paint：Skia 2.2.12 最稳的是用纯填充色（不要依赖 PaintStyle.Stroke）
  const boxPaint = useMemo(() => {
    const p = Skia.Paint();
    // 颜色用 #RRGGBB 字符串有时会触发 “string expected number”
    // 这里直接用 Skia.Color（如果你这版 Skia.Color 不可用，就改成 0xff00ff00 这种 ARGB number）
    p.setColor(Skia.Color("#00FF00"));
    return p;
  }, []);

  const labelBgPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color("rgba(0,255,0,0.85)"));
    return p;
  }, []);

  const labelTextPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color("#000000"));
    return p;
  }, []);

  // ✅ Session 只创建一次
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

  const pointPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color("blue"));
    return p;
  }, []);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";

      const size = 320;

      // frame.width 通常 1280，frame.height 720（缓冲横向）；居中裁切
      const frameWidth = frame.height;
      const scale = frameWidth / size;
      const cropOffset = (frame.width - frame.height) / 2;

      let bitmap: any = null;
      let imageStream: any = null;

      try {
        const resized = resize(frame, {
          scale: { width: size, height: size },
          rotation: "90deg",
          pixelFormat: "bgr",
          dataType: "uint8",
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
          console.log("[Worklet] faces.length =", Array.isArray(faces) ? faces.length : -1);
        }

        if (Array.isArray(faces)) {
          const border = 4;

          for (let i = 0; i < faces.length; i++) {
            const f = faces[i];
            const r = f?.rect;
            if (!r) continue;

            // InspireFace 的点位你之前用的是 point.y->x / point.x->y，所以 rect 也做同样 swap
            const x = Number(r.y ?? 0) * scale + cropOffset;
            const y = Number(r.x ?? 0) * scale;
            const w = Number(r.height ?? 0) * scale;
            const h = Number(r.width ?? 0) * scale;

            // ===== 1) 画框（不用 stroke，改画 4 条边）=====
            // top
            frame.drawRect(Skia.XYWHRect(x, y, w, border), boxPaint);
            // left
            frame.drawRect(Skia.XYWHRect(x, y, border, h), boxPaint);
            // bottom
            frame.drawRect(Skia.XYWHRect(x, y + h - border, w, border), boxPaint);
            // right
            frame.drawRect(Skia.XYWHRect(x + w - border, y, border, h), boxPaint);

            // ===== 2) 画文字：ID + 姓名 =====
            if (font) {
              const id = Number(f.trackId ?? 0);
              const name = NAME_BY_ID[id] ?? "";
              const label = name ? `ID:${id}  ${name}` : `ID:${id}`;

              const padX = 6;
              const padY = 4;
              const textW = font.getTextWidth(label) + padX * 2;
              const textH = font.getSize() + padY * 2 + 6;

              const bgX = x;
              const bgY = Math.max(0, y - textH - 6);

              frame.drawRect(Skia.XYWHRect(bgX, bgY, textW, textH), labelBgPaint);
              frame.drawText(label, bgX + padX, bgY + textH - padY - 4, labelTextPaint, font);
            }

            // ===== 3) （可选）画 landmarks：你原来的逻辑保留 =====
            const lmk: Point2f[] = BoxedInspireFace.unbox().getFaceDenseLandmarkFromFaceToken(f.token);

            lmk.forEach((pt) => {
              path.addCircle(pt.y * scale + cropOffset, pt.x * scale, 3);
            });
            frame.drawPath(path, pointPaint);
          }
        }
      } catch (e: any) {
        console.error("[Worklet] FaceTrack crash:", e?.message ?? e);
      } finally {
        try {
          imageStream?.dispose?.();
        } catch {}
        try {
          bitmap?.dispose?.();
        } catch {}
      }
    },
    [resize, boxedSession, boxPaint, labelBgPaint, labelTextPaint, pointPaint, font]
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

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission not granted (or blocked).</Text>
        <Text style={[styles.text, { marginTop: 12 }]} onPress={() => openSettings()}>
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

  // font 还没加载好也能先跑（只是暂时不画字）
  return (
    <View style={{ flex: 1 }}>
      <Camera
        ref={camera}
        style={[StyleSheet.absoluteFill, { width: PREVIEW_W, height: PREVIEW_H }]}
        device={device}
        isActive={true}
        format={format}
        frameProcessor={frameProcessor}
      />
      <Canvas style={[StyleSheet.absoluteFill, { width: PREVIEW_W, height: PREVIEW_H }]}>

      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "black" },
  text: { color: "white", fontSize: 16, marginTop: 10 },
});
