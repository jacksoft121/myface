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
import {runOnJS} from 'react-native-reanimated';

import {
  InspireFace,
  BoxedInspireFace,
  DetectMode,
  CameraRotation,
  type Face,
} from 'react-native-nitro-inspire-face';
import {Worklets} from 'react-native-worklets-core';
import {NitroModules} from "react-native-nitro-modules";

import {useResizePlugin} from "vision-camera-resize-plugin";
import {Skia} from "@shopify/react-native-skia";

/* =======================
 * 类型
 * ======================= */

type TrackedFace = {
  trackId: number;
  rect: Face['rect'];
  confidence: number;
};

/* =======================
 * 预览尺寸
 * ======================= */

const {width} = Dimensions.get('window');
const PREVIEW_W = width;
const PREVIEW_H = width * 1.33;

/* =======================
 * 全局 Session（JS 主线程）
 * ======================= */

let faceSession: any = null;

/* =======================
 * 组件
 * ======================= */

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
  let device = useCameraDevice("back");
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

  const frameProcessor = useSkiaFrameProcessor((frame) => {
    "worklet";

    console.log("frameProcessor frame.width", frame.width);
    // Draw the frame to the canvas
    frame.render();
    console.log("frameProcessor render");
    const size = 320;
    const frameWidth = frame.height; // 720
    const scaleX = frameWidth / size; // Scale based on processed width
    const cropOffset = (frame.width - frame.height) / 2; // Adjust for cropping

    // Resize frame for processing
    const resized = resize(frame, {
      scale: {
        width: size,
        height: size,
      },
      rotation: "90deg",
      pixelFormat: "bgr",
      dataType: "uint8",
      mirror: true,
    });
    console.log("frameProcessor resized", resized);
    /*
    // Unbox InspireFace instance for frame processor
    const unboxedInspireFace = BoxedInspireFace.unbox();
    console.log("frameProcessor unboxedInspireFace", unboxedInspireFace.toString());
    // Create image bitmap from frame buffer
    const bitmap = unboxedInspireFace.createImageBitmapFromBuffer(
      resized.buffer as ArrayBuffer,
      size,
      size,
      3
    );
    console.log("frameProcessor bitmap");
    // Create image stream for face detection
    const imageStream = unboxedInspireFace.createImageStreamFromBitmap(
      bitmap,
      CameraRotation.ROTATION_0
    );
    console.log("frameProcessor imageStream");
    // Unbox session and execute face detection
    const unboxedSession = session.unbox();
    const faces = unboxedSession.executeFaceTrack(imageStream);
    console.log("frameProcessor faces", faces);

    // Draw facial landmarks for each detected face
    for (let i = 0; i < faces.length; i++) {
      const lmk = unboxedInspireFace.getFaceDenseLandmarkFromFaceToken(
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

    // Clean up resources
    imageStream.dispose();
    bitmap.dispose();

    */
  }, []);
  /* =======================
   * FrameProcessor（只取 buffer）
   * ======================= */


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
        style={styles.camera}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        frameProcessorFps={5}
      />

      {faces.map((f) => (
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
