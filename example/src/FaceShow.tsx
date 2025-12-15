import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  InspireFace,
  DetectMode,
  ImageFormat,
  CameraRotation,
  type Face,
} from 'react-native-nitro-inspire-face';

/* =======================
 * 类型定义
 * ======================= */

type RootStackParamList = {
  FaceShow: {
    isFront: boolean;
    isLiveness: boolean;
    faceScore: number;
    faceQuality: number;
    facePreviewSize: string;
  };
};

type FaceShowScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'FaceShow'
>;

type TrackedFace = {
  trackId: number;
  rect: Face['rect'];
  confidence: number;
};

/* =======================
 * 常量
 * ======================= */

const { width } = Dimensions.get('window');
const PREVIEW_W = width;
const PREVIEW_H = width * 1.33;

/* =======================
 * 全局 Session（只创建一次）
 * ======================= */

let faceSession: any = null;

function ensureSession() {
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
 * 主组件
 * ======================= */

export default function FaceShowScreen({ route }: FaceShowScreenProps) {
  const device = useCameraDevice('front');
  const [hasPermission, setHasPermission] = useState(false);
  const [faces, setFaces] = useState<TrackedFace[]>([]);

  /* =======================
   * 请求相机权限
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
   * JS 回调
   * ======================= */
  const onFacesDetected = (list: TrackedFace[]) => {
    setFaces(list);
  };

  /* =======================
   * FrameProcessor
   * ======================= */
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';

    const session = ensureSession();

    const stream = InspireFace.createImageStreamFromFrame(frame);
    stream.setFormat(ImageFormat.BGR);
    stream.setRotation(CameraRotation.ROTATION_0);

    const detected = session.executeFaceTrack(stream);

    if (!detected || detected.length === 0) {
      runOnJS(onFacesDetected)([]);
      return;
    }

    const result: TrackedFace[] = detected.map((f: any) => ({
      trackId: f.trackId ?? f.token,
      rect: f.rect,
      confidence: f.confidence ?? 0,
    }));

    runOnJS(onFacesDetected)(result);
  }, []);

  /* =======================
   * UI 状态判断
   * ======================= */

  if (!hasPermission) {
    return (
      <View style={styles.root}>
        <Text style={styles.errorText}>正在请求相机权限…</Text>
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
   * 正常渲染
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
    textAlign: 'center',
  },
});
