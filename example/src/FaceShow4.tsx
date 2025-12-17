// IMPORTANT: For this component to work correctly, your project must have 'react-native-reanimated'
// version 2 or 3 correctly installed and configured.
//
// Please ensure the following:
// 1. Your `babel.config.js` file includes 'react-native-reanimated/plugin' as the LAST item in the plugins array.
//    module.exports = {
//      ...
//      plugins: [
//        ...
//        'react-native-reanimated/plugin', // This must be last!
//      ],
//    };
// 2. After verifying your babel config, you may need to reset your project's cache.
//    Stop the metro bundler and run: `npm start -- --reset-cache`
// 3. If issues persist, consider reinstalling dependencies: `rm -rf node_modules && npm install && npx pod-install`

import 'react-native-worklets-core';
import React, { useEffect, useState } from 'react';
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
import {
  runOnJS,
  useSharedValue,
  useAnimatedReaction,
} from 'react-native-reanimated';

// 常量
const { width } = Dimensions.get('window');
const PREVIEW_W = width;
const PREVIEW_H = width * (16 / 9); // 使用常见的 16:9 宽高比

// Helper for logging from the JS thread
const logJs = (context: string, data: any) => {
  console.log(`[JS] ${context}:`, JSON.stringify(data, null, 2));
};

export default function FaceShowScreen() {
  const [hasPermission, setHasPermission] = useState(false);
  const [faces, setFaces] = useState<Face[]>([]);
  const device = useCameraDevice('front');
  const { resize } = useResizePlugin();

  const facesJson = useSharedValue('[]');

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

  const BoxedSession = NitroModules.box(session);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
    return () => {};
  }, []);

  // This function runs on the JS thread to update the React state.
  const updateState = (jsonString: string) => {
    logJs('State Update', `Received data. Length: ${jsonString.length}`);
    logJs('State Update', `Received data. : ${jsonString}`);

    try {
      const newFaces = JSON.parse(jsonString);
      setFaces(newFaces);
    } catch (e) {
      console.error('[JS] Failed to parse JSON', e);
    }
  };

  // useAnimatedReaction is the correct way to listen for SharedValue changes from a worklet.
  useAnimatedReaction(
    () => facesJson.value,
    (currentValue, previousValue) => {
      'worklet';
      // 每次 facesJson.value 被访问时，这个回调都会触发。
      // 我们在这里添加日志，看它是否在运行。
      console.log('[Reaction Worklet] Fired. Checking for changes...');

      if (currentValue !== previousValue) {
        // 如果值真的变了，我们再加一条日志
        console.log('[Reaction Worklet] Value changed! Triggering JS update.');
        // 使用 runOnJS 来调用 JS 线程的函数
        runOnJS(updateState)(currentValue);
      }
    },
    [updateState] // 依赖数组
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      runAtTargetFps(30, () => {
        'worklet';
        try {
          // --- 步骤 1: 图像缩放 ---
          const resizedHeight = Math.floor((320 * frame.height) / frame.width);
          const resized = resize(frame, {
            scale: { width: 320, height: resizedHeight },
            pixelFormat: 'bgr',
            dataType: 'uint8',
          });

          // --- 步骤 2: 创建图像位图 ---
          const buffer = resized.buffer as ArrayBuffer;
          const unboxedInspireFace = BoxedInspireFace.unbox();
          const bitmap = unboxedInspireFace.createImageBitmapFromBuffer(buffer, 320, resizedHeight, 3);

          // --- 步骤 3: 执行人脸追踪 ---
          const imageStream = unboxedInspireFace.createImageStreamFromBitmap(bitmap, CameraRotation.ROTATION_0);
          const unboxedSession = BoxedSession.unbox();
          const multipleFaceData = unboxedSession.executeFaceTrack(imageStream);

          console.log('[Worklet] 1. 收到原生数据:', JSON.stringify(multipleFaceData));

          // --- 步骤 4: 数据清洗和转换 ---
          const safeFaces = (Array.isArray(multipleFaceData) ? multipleFaceData : []).map((f: any) => ({
            trackId: Number(f?.trackId ?? 0),
            rect: {
              x: Number(f?.rect?.x ?? 0),
              y: Number(f?.rect?.y ?? 0),
              width: Number(f?.rect?.width ?? 0),
              height: Number(f?.rect?.height ?? 0),
            },
          }));
          console.log('[Worklet] 2. 数据清洗完成:', JSON.stringify(safeFaces));

          // --- 步骤 5: 转换为JSON字符串 ---
          const jsonString = JSON.stringify(safeFaces);
          console.log('[Worklet] 3. JSON字符串已生成:', jsonString);

          // --- 步骤 6: 更新共享变量 ---
          facesJson.value = jsonString;
          console.log('[Worklet] 4. 共享变量已更新');

          // --- 步骤 7: 释放资源 ---
          bitmap.dispose();
          imageStream.dispose();
          console.log('[Worklet] 5. 资源已释放');

        } catch (e: Error) {
          console.error('[Worklet] 人脸追踪崩溃:', `错误名: ${e.name}, 信息: ${e.message}, 堆栈: ${e.stack}`);
        }
      });
    },
    [resize, BoxedSession, facesJson]
  );

  if (!hasPermission || !device) {
    return (
      <View style={styles.root}>
        <Text style={styles.errorText}>
          {!hasPermission ? 'Requesting camera permission...' : 'Front camera not found'}
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
        pixelFormat="yuv"
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
