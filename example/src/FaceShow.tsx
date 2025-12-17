import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import {
  Camera,
  runAtTargetFps,
  useCameraDevice,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {
  InspireFace,
  BoxedInspireFace,
  DetectMode,
  CameraRotation,
  type Face,
} from 'react-native-nitro-inspire-face';
import { NitroModules } from 'react-native-nitro-modules';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { runOnJS } from 'react-native-reanimated';
import { Skia } from "@shopify/react-native-skia";

// 常量
const { width } = Dimensions.get('window');
const PREVIEW_W = width;
const PREVIEW_H = width * (16 / 9); // 使用常见的 16:9 宽高比

export default function FaceShowScreen() {
  const [hasPermission, setHasPermission] = useState(false);
  const [faces, setFaces] = useState<Face[]>([]); // 使用 React state 来更新 UI
  const device = useCameraDevice('front');
  const { resize } = useResizePlugin();

  // 一次性初始化 InspireFace Session
  const boxedInspireFaceSession = useRef(
    (() => {
      InspireFace.launch('Pikachu');
      const session = InspireFace.createSession(
        { enableLiveness: true },
        DetectMode.ALWAYS_DETECT,
        10,
        -1, // Detection resolution level (multiple of 160, default -1 means 320)
        -1  // Frame rate for tracking mode (default -1 means 30fps)
      );
      session.setTrackPreviewSize(320);
      session.setFaceDetectThreshold(0.5);
      return NitroModules.box(session);
    })()
  ).current;

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
    // 组件卸载时清理 Session
    return () => { boxedInspireFaceSession.unbox()?.dispose(); };
  }, [boxedInspireFaceSession]);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      // 使用 runOnJS 包装 React state 更新函数
      const setFacesJS = runOnJS(setFaces);

      // 以较低的帧率运行消耗资源的人脸检测
      runAtTargetFps(15, () => {
        try {

          // 使用 resize 插件转换帧的尺寸和像素格式
          const resized = resize(frame, {
            scale: { width: 320, height: (320 * frame.height) / frame.width },
            pixelFormat: 'bgr', // InspireFace SDK 可能需要 BGR 格式
            dataType: 'uint8',
          });

          // 从转换后的帧中获取 ArrayBuffer
          const buffer = resized.buffer as ArrayBuffer;
          const unboxedInspireFace = BoxedInspireFace.unbox();

          // 使用转换后的 buffer 和尺寸创建 bitmap
          const bitmap = unboxedInspireFace.createImageBitmapFromBuffer(buffer, 320, 320, 3);
          const imageStream = unboxedInspireFace.createImageStreamFromBitmap(bitmap, CameraRotation.ROTATION_0);

          const unboxedSession = boxedInspireFaceSession.unbox();
          const multipleFaceData = unboxedSession.executeFaceTrack(imageStream);
          console.log('multipleFaceData:', multipleFaceData.length);
          // 安全地更新 UI state 来绘制人脸框
          // setFacesJS(multipleFaceData);

          bitmap.dispose();
          imageStream.dispose();
        } catch (e:Error) {
          console.error('人脸追踪出错:'+e.name+' message:'+e.message+' stack:'+e.stack);
        }
      });
    },
    [resize, boxedInspireFaceSession]
  );

  if (!hasPermission || !device) {
    return (
      <View style={styles.root}>
        <Text style={styles.errorText}>
          {!hasPermission ? '正在请求相机权限...' : '未找到前置摄像头'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Camera
        style={[StyleSheet.absoluteFill, { width: PREVIEW_W, height: PREVIEW_H }]}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv" // 使用 yuv 格式，更稳定
      />

      {/* 使用绝对定位的 View 在预览之上叠加人脸框 */}
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
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
