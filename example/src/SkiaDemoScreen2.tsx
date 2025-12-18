import React, {useEffect, useState, useCallback, useMemo} from 'react';
import {StyleSheet, View, Text, ActivityIndicator} from 'react-native';
import {Canvas, Rect} from '@shopify/react-native-skia';
import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
  runAtTargetFps,
} from 'react-native-vision-camera';
import {useSharedValue} from 'react-native-reanimated';
import {Worklets} from 'react-native-worklets-core';

type RectData = {x: number; y: number; width: number; height: number};

export const SkiaDemoScreen = () => {
  const device = useCameraDevice('front');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // ✅ 4 个数值 SharedValue
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const rw = useSharedValue(0);
  const rh = useSharedValue(0);

  // ✅ JS 日志：节流（每秒最多一次）
  const lastLogMs = useSharedValue(0);

  useEffect(() => {
    console.log('[SkiaDemo] mounted');
    (async () => {
      const status = await Camera.requestCameraPermission();
      console.log('[SkiaDemo] camera permission status =', status);
      setHasPermission(status === 'granted');
    })();
    return () => console.log('[SkiaDemo] unmounted');
  }, []);

  // ✅ JS 侧日志函数（将被 worklet 用 runOnJS 调用）
  const logJS = useCallback((...args: any[]) => {
    console.log('[SkiaDemo]', ...args);
  }, []);

  // ✅ JS 回调：更新 SharedValue（也做节流日志）
  const onFacesJS = useCallback((rect: RectData | null) => {
    if (rect) {
      rx.value = rect.x;
      ry.value = rect.y;
      rw.value = rect.width;
      rh.value = rect.height;
    } else {
      rw.value = 0;
      rh.value = 0;
    }

    // 这里也可以打：每秒一次
    const now = Date.now();
    if (now - lastLogMs.value >= 1000) {
      lastLogMs.value = now;
      console.log('[SkiaDemo][JS] rect =', rect);
    }
  }, [rx, ry, rw, rh, lastLogMs]);

  // ✅ worklet -> JS 的“上报人脸框”
  const reportFaces = useMemo(() => Worklets.createRunOnJS(onFacesJS), [onFacesJS]);

  // ✅ worklet -> JS 的“打印日志”
  const logFromWorklet = useMemo(() => Worklets.createRunOnJS(logJS), [logJS]);

  // ✅ FrameProcessor：限频 + 节流打印
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      // 只处理 15fps
      runAtTargetFps(15, () => {
        'worklet';

        // 每秒最多打印一次（worklet 侧用 timestamp 控制）
        const tsMs = frame.timestamp / 1e6; // VisionCamera timestamp 单位通常是 ns，这里做个近似
        const sec = Math.floor(tsMs / 1000);

        // mock：用时间戳做一个变化
        const t = Math.floor(frame.timestamp / 1e7) % 200;
        if (t < 150) {
          const mockX = 50 + t;
          const rect = {x: mockX, y: 100, width: 150, height: 200};
          reportFaces(rect);

          // ✅ 节流日志：每秒一次
          if (t % 15 === 0) {
            // 约等于每秒一次（15fps下）
            logFromWorklet('[FP] sec=', sec, 't=', t, 'rect=', rect);
          }
        } else {
          reportFaces(null);
          if (t % 15 === 0) {
            logFromWorklet('[FP] sec=', sec, 't=', t, 'rect=null');
          }
        }
      });
    },
    [reportFaces, logFromWorklet],
  );

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
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
        onInitialized={() => console.log('[SkiaDemo] Camera initialized')}
        onError={(e) => console.log('[SkiaDemo] Camera error', e)}
      />

      <Canvas style={StyleSheet.absoluteFill}>
        <Rect
          x={rx}
          y={ry}
          width={rw}
          height={rh}
          color="rgba(255, 165, 0, 0.7)"
          style="stroke"
          strokeWidth={4}
        />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'black'},
  text: {color: 'white', fontSize: 16, marginTop: 10},
});
