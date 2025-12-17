import { Skia } from "@shopify/react-native-skia";
import {useEffect, useMemo, useRef, useState} from "react";
import {ActivityIndicator, Platform, StyleSheet, Text, View} from "react-native";
import {
  BoxedInspireFace,
  CameraRotation,
  DetectMode, type FaceData,
  InspireFace, type Point2f,
} from "react-native-nitro-inspire-face";
import { NitroModules } from "react-native-nitro-modules";
import {
  Camera,
  Templates,
  useCameraDevice,
  useCameraFormat,
  useSkiaFrameProcessor,
} from "react-native-vision-camera";
import { useResizePlugin } from "vision-camera-resize-plugin";
import { check, request, openSettings, PERMISSIONS, RESULTS } from "react-native-permissions";


// Launch the model package
InspireFace.launch("Pikachu");

/**
 * 如果识别结果里拿不到姓名，你可以在这里维护一份 personId->name 映射
 * （比如从你自己的人员库加载后塞进来）
 */
const NAME_BY_ID: Record<number, string> = {
  1: "张三",
  2: "李四",
};

// 日志节流：大概每 1s 打一次（避免刷屏卡顿）
function shouldLog(ts: number) {
  "worklet";
  return (Math.floor(ts / 1e9) % 1) === 0 && (ts % 1e9) < 2e7; // 约每秒前 20ms 打一次
}

function getCameraPermissionConst() {
  return Platform.select({
    ios: PERMISSIONS.IOS.CAMERA,
    android: PERMISSIONS.ANDROID.CAMERA,
    default: PERMISSIONS.ANDROID.CAMERA,
  });
}

export default function Example() {
  const device = useCameraDevice("front"); // ✅ 人脸识别一般用前置
  const camera = useRef<Camera>(null);
  const { resize } = useResizePlugin();
  const format = useCameraFormat(device, Templates.FrameProcessing);
  const [hasPermission, setHasPermission] = useState(false);

  // ====== 权限：react-native-permissions ======
  useEffect(() => {
    (async () => {
      const perm = getCameraPermissionConst();
      const st0 = await check(perm);
      if (st0 === RESULTS.GRANTED || st0 === RESULTS.LIMITED) {
        setHasPermission(true);
        return;
      }
      const st1 = await request(perm);
      setHasPermission(st1 === RESULTS.GRANTED || st1 === RESULTS.LIMITED);
    })();
  }, []);

  // 画框 Paint（描边）
  const boxPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color("#00FF00"));
    p.setStyle(Skia.PaintStyle.Stroke);
    p.setStrokeWidth(4);
    return p;
  }, []);

  // 文字背景 Paint（实心）
  const labelBgPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color("rgba(0,255,0,0.85)"));
    p.setStyle(Skia.PaintStyle.Fill);
    return p;
  }, []);

  // 文字 Paint（实心）
  const labelTextPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color("#000000"));
    p.setStyle(Skia.PaintStyle.Fill);
    return p;
  }, []);

  // 字体
  const font = useMemo(() => {
    const tf = Skia.Typeface.MakeDefault();
    return Skia.Font(tf, 20);
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

    // 让它可在 worklet 里用
    return NitroModules.box(s);
  }, []);
  const paint = Skia.Paint();
  paint.setColor(Skia.Color("blue"));
  const frameProcessor = useSkiaFrameProcessor((frame) => {
    "worklet";

    // 先把原始相机帧渲染出来（否则你画的东西可能看不到底图）
    frame.render();

    try {
      const size = 320;

      // 你示例里的坐标换算逻辑继续沿用：
      // frame.width 通常是 1280，frame.height 720（横屏缓冲），预览再裁成居中
      const frameWidth = frame.height;
      const scaleX = frameWidth / size; // 720/320=2.25
      const cropOffset = (frame.width - frame.height) / 2;

      // 1) resize 到 320x320 做检测（旋转 + mirror 按你示例）
      const resized = resize(frame, {
        scale: { width: size, height: size },
        rotation: "90deg",
        pixelFormat: "bgr",
        dataType: "uint8",
        mirror: true, // 前置镜像 ✅
      });

      const unboxedInspireFace = BoxedInspireFace.unbox();
      const bitmap = unboxedInspireFace.createImageBitmapFromBuffer(
        resized.buffer as ArrayBuffer,
        size,
        size,
        3
      );

      const imageStream = unboxedInspireFace.createImageStreamFromBitmap(
        bitmap,
        CameraRotation.ROTATION_0
      );

      const session = boxedSession.unbox();
      const faces:FaceData[] = session.executeFaceTrack(imageStream);

      if (shouldLog(frame.timestamp)) {
        console.log("[Worklet] faces.length =", Array.isArray(faces) ? faces.length : -1);
      }
      // Draw facial landmarks for each detected face
      if (Array.isArray(faces)){
        for (let i = 0; i < faces.length; i++) {
          const lmk:Point2f[] = unboxedInspireFace.getFaceDenseLandmarkFromFaceToken(
            faces[i].token
          );
          const path = Skia.Path.Make();

          // Draw landmark points
          lmk.forEach((point) => {
            path.addCircle(point.y * scaleX + cropOffset, point.x * scaleX, 3);
          });

          // Draw landmarks to canvas
          frame.drawPath(path, paint);
        }
      }

      // 释放
      imageStream.dispose();
      bitmap.dispose();
    } catch (e: any) {
      console.error("[Worklet] FaceTrack crash:", e?.message ?? e);
    }
  }, [resize, boxedSession, boxPaint, labelBgPaint, labelTextPaint, font]);

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
        <Text style={styles.text}>Camera permission has not been granted.</Text>
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
    <View style={{ flex: 1 }}>
        <Camera
          ref={camera}
          style={{ flex: 1 }}
          device={device!}
          isActive={true}
          format={format}
          frameProcessor={frameProcessor}
        />
    </View>
  );
};


const styles = StyleSheet.create({
  container: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'black'},
  text: {color: 'white', fontSize: 16, marginTop: 10},
});
