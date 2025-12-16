import React, {useEffect, useRef, useState} from 'react';
import {View, Text, StyleSheet, Dimensions} from 'react-native';
import {
  Camera,
  runAtTargetFps,
  useCameraDevice,
  useFrameProcessor,
  Templates,
  useCameraFormat,
  useSkiaFrameProcessor,
} from 'react-native-vision-camera';

import {
  InspireFace,
  BoxedInspireFace,
  DetectMode,
  CameraRotation,
  type Face, type Session,
} from 'react-native-nitro-inspire-face';
import {Worklets} from 'react-native-worklets-core';
import {NitroModules} from "react-native-nitro-modules";

import {useResizePlugin} from "vision-camera-resize-plugin";
import {Skia, Canvas, useCanvasSize, Rect, size} from "@shopify/react-native-skia";
import {useSharedValue, useDerivedValue,runOnJS} from "react-native-reanimated";

/* =======================
 * 类型
 * ======================= */

type TrackedFace = {
  trackId: number;
  rect: Face['rect'];
  confidence: number;
};


const {width, height} = Dimensions.get('window');
const PREVIEW_W = width;
const PREVIEW_H = width * 1.33;


/* =======================
 * 全局 Session（JS 主线程）
 * ======================= */

let faceSession: any = null;

/* =======================
 * 组件
 * ======================= */
//Launch the model package
InspireFace.launch("Pikachu");
export default function FaceShowScreen() {
  const [hasPermission, setHasPermission] = useState(false);
  const [faces, setFaces] = useState<TrackedFace[]>([]);

  /* =======================
   * 权限
   * ======================= */

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();

    return () => {
      if (faceSession) {
        faceSession.dispose();
        faceSession = null;
      }
    };
  }, []);

  /* =======================
   * JS 识别逻辑（核心）
   * ======================= */
  let device = useCameraDevice("front");
  const camera = useRef<Camera>(null);
  const {resize} = useResizePlugin();

  const format = useCameraFormat(device, Templates.FrameProcessing);

  const paint = Skia.Paint();
  paint.setColor(Skia.Color("blue"));

  const session = InspireFace.createSession(
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
  session.setTrackPreviewSize(320);
  session.setFaceDetectThreshold(0.5);
  const boxedInspireFaceSession = NitroModules.box(session);

  const facesSharedValue = useSharedValue([]);
  const cameraProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      console.log(
        `Frame打印: ${frame.width}x${frame.height} (${frame.pixelFormat})`
      );


      // 性能优化：限制每秒处理多少帧 (例如 15fps)，防止手机发烫
      runAtTargetFps(15, () => {
        console.log(`runAtTargetFps 15fps`);
        // RGBA → ImageBitmap
        const buffer = frame.toArrayBuffer();
        console.log(
          `Frame打印2: ${frame.width}x${frame.height} (${frame.pixelFormat})`
        );
        console.log(`runAtTargetFps buffer= ${buffer.byteLength}`);
        try {
          const resized = resize(frame, {
            scale: {
              width: frame.width/2,
              height: frame.height/2,
            },
            rotation: "90deg",
            pixelFormat: "bgr",
            dataType: "uint8",
            mirror: true,
          });
          // Unbox InspireFace instance for frame processor
          const unboxedInspireFace = BoxedInspireFace.unbox();

          // Create image bitmap from frame buffer
          const bitmap = unboxedInspireFace.createImageBitmapFromBuffer(
            buffer as ArrayBuffer,
            frame.width/2,
            frame.height/2,
            3
          );

          // Create image stream for face detection
          const imageStream = unboxedInspireFace.createImageStreamFromBitmap(
            bitmap,
            CameraRotation.ROTATION_0
          );

          // Unbox session and execute face detection
          const unboxedSession = boxedInspireFaceSession.unbox();
          const multipleFaceData = unboxedSession.executeFaceTrack(imageStream);
          if (multipleFaceData.length === 0) {
            console.log('未检测到人脸');
            return;
          }
          console.log('检测到人脸'+multipleFaceData.length+'张');
          console.log("frameProcessor facesTrack", multipleFaceData);
          facesSharedValue.value = multipleFaceData;
          bitmap.dispose();
          imageStream.dispose();

        } catch (e) {
          console.error('Tracking Error:', e);
        } finally {

        }



      });
    },
    []
  );


  const frameSkiaProcessor = useSkiaFrameProcessor((frame) => {
    "worklet";

    console.log("frameSkiaProcessor frame.width", frame.width);
    // Draw the frame to the canvas
    frame.render();
    console.log("frameSkiaProcessor render");


  }, []);


  /* =======================
   * UI 状态
   * ======================= */

  if (!hasPermission) {
    return (
      <View style={styles.root}>
        <Text style={styles.errorText}>请求相机权限中…</Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.root}>
        <Text style={styles.errorText}>未检测到前置摄像头</Text>
      </View>
    );
  }

  /* =======================
   * 渲染
   * ======================= */

  return (
    <View style={styles.root}>
      <Camera
        style={{ width: PREVIEW_W, height: PREVIEW_H }}
        device={device}
        isActive={true}
        frameProcessor={cameraProcessor}
        frameProcessorFps={5}
      />
      <Canvas
        style={{ width: PREVIEW_W, height: PREVIEW_H }}
      />

      {facesSharedValue.value.map((f) => (
        <View
          key={f.trackId}
          style={[
            styles.box,
            {
              left: f.rect.x * PREVIEW_W,
              top: f.rect.y * PREVIEW_H,
              width: f.rect.width * PREVIEW_W,
              height: f.rect.height * PREVIEW_H,
            },
          ]}
        >
          <Text style={styles.label}>ID:{f.trackId}</Text>
        </View>
      ))}
    </View>
  );
}

/* =======================
 * 样式
 * ======================= */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    width: PREVIEW_W,
    height: PREVIEW_H,
  },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#00FF00',
  },
  label: {
    position: 'absolute',
    top: -18,
    left: 0,
    backgroundColor: '#00FF00',
    color: '#000',
    fontSize: 12,
    paddingHorizontal: 4,
  },
  errorText: {
    color: 'white',
    fontSize: 18,
  },
});
