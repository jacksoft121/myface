import 'react-native-worklets-core';
import React, {useEffect, useMemo, useCallback, useState} from 'react';
import {View, Text, StyleSheet, Dimensions} from 'react-native';
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
import {NitroModules} from 'react-native-nitro-modules';
import {useResizePlugin} from 'vision-camera-resize-plugin';
import {Worklets} from 'react-native-worklets-core';

// ====== 常量 ======
const {width} = Dimensions.get('window');
const PREVIEW_W = width;
const PREVIEW_H = width * (16 / 9);

// 是否镜像 X（前摄通常需要镜像才能对齐 UI）
const MIRROR_X = true;

// 追踪输入宽度（与你 session.setTrackPreviewSize(320) 一致）
const TRACK_W = 320;

// 日志开关（建议先开着，稳定后关掉）
const DEBUG_JS = true;
const DEBUG_WORKLET = false;

// JS 日志
const logJs = (tag: string, data?: any) => {
  if (!DEBUG_JS) return;
  try {
    if (data === undefined) console.log(`[JS] ${tag}`);
    else console.log(`[JS] ${tag}:`, data);
  } catch (e) {
    console.log(`[JS] ${tag}: <log failed>`, e);
  }
};

type FaceBox = {trackId: number; rect: {x: number; y: number; width: number; height: number}};

export default function FaceShowScreen() {
  const [hasPermission, setHasPermission] = useState(false);
  const [faces, setFaces] = useState<FaceBox[]>([]);
  const device = useCameraDevice('front');
  const {resize} = useResizePlugin();

  // ✅ Session & BoxedSession 只创建一次（不要放 render 里每次创建）
  const BoxedSession = useMemo(() => {
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
    session.setTrackPreviewSize(TRACK_W);
    session.setFaceDetectThreshold(0.5);

    logJs('Session created', {trackPreviewSize: TRACK_W, threshold: 0.5});
    return NitroModules.box(session);
  }, []);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
      logJs('Camera permission', status);
    })();
  }, []);

  // ✅ JS 线程更新 state
  const onFacesJS = useCallback((payload: {faces: FaceBox[]; meta: any}) => {
    const {faces: newFaces, meta} = payload;
    setFaces(newFaces);

    // 限频日志：每秒最多一次（meta.secKey）
    if (DEBUG_JS) {
      logJs(`Faces update (count=${newFaces.length})`, {
        secKey: meta?.secKey,
        resizedH: meta?.resizedH,
        scaleX: meta?.scaleX,
        scaleY: meta?.scaleY,
        first: newFaces[0] ?? null,
      });
    }
  }, []);

  // ✅ worklet -> JS 的桥（你之前跑通的那套）
  const reportFaces = useMemo(() => Worklets.createRunOnJS(onFacesJS), [onFacesJS]);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      // 建议 10~15fps；30fps + JS 回调很容易淹没
      runAtTargetFps(15, () => {
        'worklet';

        // 用 timestamp 做一个“秒级 key”给日志限频
        const secKey = Math.floor(frame.timestamp / 1e9);

        let bitmap: any = null;
        let imageStream: any = null;

        try {
          // --- 1) resize 到 TRACK_W ---
          const resizedH = Math.floor((TRACK_W * frame.height) / frame.width);
          const resized = resize(frame, {
            scale: {width: TRACK_W, height: resizedH},
            pixelFormat: 'bgr',
            dataType: 'uint8',
          });

          const buffer = resized.buffer as ArrayBuffer;

          // --- 2) bitmap + imageStream ---
          const unboxedInspireFace = BoxedInspireFace.unbox();
          bitmap = unboxedInspireFace.createImageBitmapFromBuffer(buffer, TRACK_W, resizedH, 3);

          // 你这里先固定 ROTATION_0；如果框方向不对，再按 frame.orientation 映射
          imageStream = unboxedInspireFace.createImageStreamFromBitmap(
            bitmap,
            CameraRotation.ROTATION_0
          );

          // --- 3) executeFaceTrack ---
          const unboxedSession = BoxedSession.unbox();
          const raw = unboxedSession.executeFaceTrack(imageStream);

          // --- 4) 清洗 & 坐标映射到 PREVIEW 像素 ---
          const scaleX = PREVIEW_W / TRACK_W;
          const scaleY = PREVIEW_H / resizedH;

          const safeFaces: FaceBox[] = (Array.isArray(raw) ? raw : []).map((f: any) => {
            const trackId = Number(f?.trackId ?? 0);

            // 原始像素坐标（相对于 TRACK_W x resizedH）
            let x = Number(f?.rect?.x ?? 0);
            const y = Number(f?.rect?.y ?? 0);
            const w = Number(f?.rect?.width ?? 0);
            const h = Number(f?.rect?.height ?? 0);

            // 前摄镜像（让框和预览一致）
            if (MIRROR_X) {
              x = TRACK_W - (x + w);
            }

            // 映射到预览像素
            return {
              trackId,
              rect: {
                x: x * scaleX,
                y: y * scaleY,
                width: w * scaleX,
                height: h * scaleY,
              },
            };
          });

          if (DEBUG_WORKLET && secKey % 2 === 0) {
            console.log('[Worklet] tracked faces:', safeFaces.length);
          }

          // --- 5) 回到 JS 更新 state ---
          reportFaces({
            faces: safeFaces,
            meta: {secKey, resizedH, scaleX, scaleY, frameW: frame.width, frameH: frame.height},
          });
        } catch (e: any) {
          // worklet 内尽量只打关键信息
          console.error('[Worklet] FaceTrack error:', e?.message ?? String(e));
          reportFaces({
            faces: [],
            meta: {secKey, error: e?.message ?? String(e)},
          });
        } finally {
          // --- 6) 释放 ---
          try {
            bitmap?.dispose?.();
            imageStream?.dispose?.();
          } catch {}
        }
      });
    },
    [resize, BoxedSession, reportFaces]
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
        style={[StyleSheet.absoluteFill, {width: PREVIEW_W, height: PREVIEW_H}]}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />

      {faces.map((f) => (
        <View
          key={String(f.trackId)}
          style={[
            styles.box,
            {
              left: f.rect.x,
              top: f.rect.y,
              width: f.rect.width,
              height: f.rect.height,
            },
          ]}>
          <Text style={styles.label}>ID:{f.trackId}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center'},
  box: {position: 'absolute', borderWidth: 2, borderColor: '#00FF00'},
  label: {
    position: 'absolute',
    top: -18,
    left: 0,
    backgroundColor: '#00FF00',
    color: '#000',
    fontSize: 12,
    paddingHorizontal: 4,
  },
  errorText: {color: 'white', fontSize: 18},
});
