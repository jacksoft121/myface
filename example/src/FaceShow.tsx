import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';

import {
  InspireFace,
  DetectMode,
  CameraRotation,
  type Face,
} from 'react-native-nitro-inspire-face';

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

function getSession() {
  if (faceSession) return faceSession;

  faceSession = InspireFace.createSession(
    {
      enableRecognition: true,
      enableFaceQuality: false,
      enableFaceAttribute: false,
      enableLiveness: false,
      enableMaskDetect: false,
    },
    DetectMode.ALWAYS_DETECT,
    10,
    -1,
    -1
  );

  faceSession.setTrackPreviewSize(320);
  faceSession.setFaceDetectThreshold(0.5);
  faceSession.setFilterMinimumFacePixelSize(0);

  return faceSession;
}

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

  const onFrameJS = (
    buffer: ArrayBuffer,
    width: number,
    height: number
  ) => {
    const session = getSession();

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

  /* =======================
   * FrameProcessor（只取 buffer）
   * ======================= */

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';

    const buffer = frame.toArrayBuffer();

    runOnJS(onFrameJS)(
      buffer,
      frame.width,
      frame.height
    );
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
