import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import {
  Camera,
  runAtTargetFps,
  useCameraDevice,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';

import {
  InspireFace,
  BoxedInspireFace,
  DetectMode,
  CameraRotation,
  type Face,
} from 'react-native-nitro-inspire-face';
import { Worklets } from 'react-native-worklets-core';

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

const { width } = Dimensions.get('window');
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
  const device = useCameraDevice('front');
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

  const onFrameJS = (buffer: ArrayBuffer, width: number, height: number) => {
    const session = sessionRef.current;

    // RGBA → ImageBitmap
    const bitmap = InspireFace.createImageBitmapFromBuffer(
      buffer,
      width,
      height,
      4
    );

    // Bitmap → ImageStream
    const stream = InspireFace.createImageStreamFromBitmap(
      bitmap,
      CameraRotation.ROTATION_0
    );

    const detected = session.executeFaceTrack(stream);

    if (!detected || detected.length === 0) {
      setFaces([]);
      return;
    }

    const result: TrackedFace[] = detected.map((f: any) => ({
      trackId: f.trackId ?? f.token,
      rect: f.rect,
      confidence: f.confidence ?? 0,
    }));

    setFaces(result);
  };

  // 1. 定义一个普通的 JS 函数 (例如更新 state，或者打印日志)
  const onFaceDetected = Worklets.createRunOnJS((buffer: ArrayBuffer) => {
    console.log('我是 JS 线程，我收到了数据size:', buffer.byteLength);
  });
  /* =======================
   * FrameProcessor（只取 buffer）
   * ======================= */

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      const size = 320;
      const frameWidth = frame.height; // 720
      const scaleX = frameWidth / size; // Scale based on processed width
      const cropOffset = (frame.width - frame.height) / 2; // Adjust for cropping

      console.log(
        `Frame打印: ${frame.width}x${frame.height} (${frame.pixelFormat})`
      );
      const buffer = frame.toArrayBuffer();
      console.log(
        `Frame打印2: ${frame.width}x${frame.height} (${frame.pixelFormat})`
      );

      // 性能优化：限制每秒处理多少帧 (例如 15fps)，防止手机发烫
      runAtTargetFps(15, () => {
        console.log(`runAtTargetFps 15fps`);
        // RGBA → ImageBitmap
        console.log(`runAtTargetFps buffer= ${buffer.byteLength}`);
        // onFaceDetected(buffer)

        try {
          const unboxedInspireFace = BoxedInspireFace.unbox();
          console.log(`runAtTargetFps unboxedInspireFace= ${unboxedInspireFace.toString()}`);

          // Create image bitmap from frame buffer
          const bitmap = unboxedInspireFace.createImageBitmapFromBuffer(
              buffer as ArrayBuffer,
              size,
              size,
              3
          );
          console.log(`runAtTargetFps bitmap= ${bitmap.width}x${bitmap.height}`);
          // Create image stream for face detection
          const imageStream = unboxedInspireFace.createImageStreamFromBitmap(
              bitmap,
              CameraRotation.ROTATION_0
          );
          console.log(`runAtTargetFps imageStream`);
          // Clean up resources
          imageStream.dispose();
          bitmap.dispose();
        } catch (e) {

          console.error('Tracking Error:', e);
        } finally {

        }

        /*// 核心调用：将 frame 传给 InspireFace
      // 注意：这里取决于你的 Nitro 模块怎么写的，通常需要传 frame 对象
      // 有些库可能需要 frame.toArrayBuffer() 或者 frame.pixelFormat
      const result = InspireFace.detect(frame);

      // 如果检测到了人脸
      if (result && result.length > 0) {
        console.log(`Detected ${result.length} faces`);

        // 回调到 JS 主线程更新 UI (绘制红框等)
        updateFacesInState(result);
      }*/
      });
    },
    [onFaceDetected]
  );

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
