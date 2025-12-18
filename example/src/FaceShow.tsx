import 'react-native-worklets-core';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native'; // 导入 useIsFocused

import {
  BoxedInspireFace,
  CameraRotation,
  DetectMode,
  InspireFace,
  type FaceData,
} from 'react-native-nitro-inspire-face';
import { NitroModules } from 'react-native-nitro-modules';

import {
  Camera,
  Templates,
  useCameraDevice,
  useCameraFormat,
  useFrameProcessor,
  runAtTargetFps,
} from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';

import {
  check,
  request,
  openSettings,
  PERMISSIONS,
  RESULTS,
} from 'react-native-permissions';

import { Worklets } from 'react-native-worklets-core';
import { Canvas, Rect, Text as SkiaText, useFont } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';
import { type RegisteredFacesDTO, type FaceBoxBuf, type FaceBoxUI } from './dto/DlxTypes';

import { STORAGE_KEYS, userInfoCacheStorage } from './comm/GlobalStorage';
import { log, logPerformance } from './comm/logger';

// #region Constants
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CAMERA_CONTAINER_HEIGHT = SCREEN_HEIGHT * (2 / 3);
const INFO_CONTAINER_HEIGHT = SCREEN_HEIGHT * (1 / 3);
const PREVIEW_W = SCREEN_WIDTH;
const PREVIEW_H = CAMERA_CONTAINER_HEIGHT;
// #endregion

// #region Helper Functions
function getCameraPermissionConst() {
  return Platform.select({
    ios: PERMISSIONS.IOS.CAMERA,
    android: PERMISSIONS.ANDROID.CAMERA,
    default: PERMISSIONS.ANDROID.CAMERA,
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mapBufRectToView(
  b: FaceBoxBuf,
  frameW: number,
  frameH: number,
  viewW: number,
  viewH: number,
  mirror: boolean
) {
  'worklet';
  const rotatedW = frameH;
  const rotatedH = frameW;

  const xP = b.y;
  const yP = frameW - (b.x + b.width);
  const wP = b.height;
  const hP = b.width;

  const scale = Math.max(viewW / rotatedW, viewH / rotatedH);
  const scaledW = rotatedW * scale;
  const scaledH = rotatedH * scale;
  const offsetX = (viewW - scaledW) / 2;
  const offsetY = (viewH - scaledH) / 2;

  let x = xP * scale + offsetX;
  let y = yP * scale + offsetY;
  let w = wP * scale;
  let h = hP * scale;

  if (mirror) {
    x = viewW - (x + w);
  }

  x = clamp(x, -viewW, viewW * 2);
  y = clamp(y, -viewH, viewH * 2);
  w = clamp(w, 0, viewW * 2);
  h = clamp(h, 0, viewH * 2);

  return { x, y, width: w, height: h };
}
// #endregion

export default function FaceShow() {
  const device = useCameraDevice('front');
  const camera = useRef<Camera>(null);
  const { resize } = useResizePlugin();
  const [registeredFacesMap, setRegisteredFacesMap] = useState(new Map<number, string>());
  const [hubFaceCount, setHubFaceCount] = useState(0); // 新增 State
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [boxes, setBoxes] = useState<FaceBoxUI[]>([]);
  const [recognizedPerson, setRecognizedPerson] = useState<{ id: number, name: string, confidence: number } | null>(null);

  const format = useCameraFormat(device, Templates.FrameProcessing);
  const canvasSize = useSharedValue({ width: PREVIEW_W, height: PREVIEW_H });
  const font = useFont(require('./assets/fonts/PingFangSC-Regular.ttf'), 18);
  const [cameraInitialized, setCameraInitialized] = useState(false);
  const isFocused = useIsFocused();

  useEffect(() => {
    const loadData = async () => {
      if (isFocused) {
        const perm = getCameraPermissionConst();
        if (!perm) {
          setHasPermission(false);
          return;
        }
        const st0 = await check(perm);
        if (st0 === RESULTS.GRANTED || st0 === RESULTS.LIMITED) {
          setHasPermission(true);
        } else {
          const st1 = await request(perm);
          setHasPermission(st1 === RESULTS.GRANTED || st1 === RESULTS.LIMITED);
        }

        const allKeys = userInfoCacheStorage.getAllKeys();
        const newMap = new Map<number, string>();

        for (const key of allKeys) {
          try {
            const jsonString = userInfoCacheStorage.getString(key);
            if (jsonString) {
              if (key === STORAGE_KEYS.REGISTERED_FACES) {
                const faces: RegisteredFacesDTO[] = JSON.parse(jsonString);
                for (const face of faces) {
                  newMap.set(face.faceId, face.name);
                }
              } else {
                const userData: RegisteredFacesDTO = JSON.parse(jsonString);
                if (userData?.faceId && userData.name) {
                  newMap.set(userData.faceId, userData.name);
                }
              }
            }
          } catch (e) {
            console.warn(`Error parsing data for key "${key}":`, e);
          }
        }
        setRegisteredFacesMap(newMap);

        // 从 FeatureHub 获取真实数量
        const count = InspireFace.featureHubGetFaceCount();
        setHubFaceCount(count);
        log(`Reloaded ${newMap.size} faces on focus. Hub count: ${count}`);
      }
    };

    loadData();
  }, [isFocused]);

  const boxedSession = useMemo(() => {
    const s = InspireFace.createSession(
      {
        enableRecognition: true,
        enableFaceQuality: true,
      },
      DetectMode.ALWAYS_DETECT,
      5, -1, -1
    );
    s.setTrackPreviewSize(320);
    s.setFaceDetectThreshold(0.5);
    s.setTrackModeSmoothRatio(0.7);
    s.setTrackModeDetectInterval(10);
    s.setFilterMinimumFacePixelSize(50);
    return NitroModules.box(s);
  }, []);

  const reportFacesToJS = useMemo(() => {
    return Worklets.createRunOnJS(
      (payload: { frameW: number; frameH: number; faces: FaceBoxBuf[] }) => {
        logPerformance('Total JS processing', () => {
          const { frameW, frameH, faces } = payload;
          const mirror = true;

          const recognized = logPerformance('Find recognized person', () =>
            faces.find(face => face.isMatched && face.confidence)
          );

          if (recognized) {
            setRecognizedPerson({
              id: recognized.trackId,
              name: recognized.name || '',
              confidence: recognized.confidence || 0,
            });
          } else {
            setRecognizedPerson(null);
          }

          const next = logPerformance('Map faces', () =>
            faces.map((b) => {
              const mapped = mapBufRectToView(b, frameW, frameH, PREVIEW_W, PREVIEW_H, mirror);
              return { ...mapped, id: b.trackId, name: b.name, confidence: b.confidence, isMatched: b.isMatched };
            })
          );
          setBoxes(next);
        });
      }
    );
  }, []);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      logPerformance('Total frame processing', () => {
        runAtTargetFps(30, () => {
          'worklet';
          const size = 320;
          const frameWidth = frame.height;
          const scaleX = frameWidth / size;
          const cropOffset = (frame.width - frame.height) / 2;

          let bitmap: any = null;
          let imageStream: any = null;

          try {
            const resized = logPerformance('Resize', () =>
              resize(frame, {
                scale: { width: size, height: size },
                rotation: '90deg',
                pixelFormat: 'bgr',
                dataType: 'uint8',
                mirror: true,
              })
            );

            const unboxedInspireFace = BoxedInspireFace.unbox();
            bitmap = logPerformance('featureHubGetFaceCount count', () => {
                const count = unboxedInspireFace.featureHubGetFaceCount();
                console.log('featureHubGetFaceCount count =', count);
              }
            );
            bitmap = logPerformance('Create bitmap', () =>
              unboxedInspireFace.createImageBitmapFromBuffer(resized.buffer as ArrayBuffer, size, size, 3)
            );

            imageStream = logPerformance('Create stream', () =>
              unboxedInspireFace.createImageStreamFromBitmap(bitmap, CameraRotation.ROTATION_0)
            );

            const session = boxedSession.unbox();
            const faces: FaceData[] = logPerformance('Face tracking', () =>
              session.executeFaceTrack(imageStream)
            );
            log('[Worklet] faces.length =', Array.isArray(faces) ? faces.length : -1);

            const out: FaceBoxBuf[] = logPerformance('Process faces', () => {
              const processedFaces: FaceBoxBuf[] = [];
              if (Array.isArray(faces)) {
                for (const f of faces as any[]) {
                  if (!f?.rect) continue;

                  const feature = session.extractFaceFeature(imageStream, f.token);
                  const searched = unboxedInspireFace.featureHubFaceSearch(feature);

                  if (searched) {
                    log(`[Debug] Searched Result - ID: ${searched.id}, Confidence: ${searched.confidence}`);
                  }

                  let name = '未注册';
                  let confidence = 0;
                  let isMatched = false;

                  if (searched?.confidence && searched.confidence > 0.5) {
                    const foundName = registeredFacesMap.get(searched.id);
                    if (foundName) {
                      name = foundName;
                      confidence = searched.confidence;
                      isMatched = true;
                    }
                  }

                  let { x: rx, y: ry, width: rw, height: rh } = f.rect;
                  if (rw <= 1.5 && rh <= 1.5) {
                    rx *= size; ry *= size; rw *= size; rh *= size;
                  }

                  const xBuf = ry * scaleX + cropOffset;
                  const yBuf = rx * scaleX;
                  const wBuf = rh * scaleX;
                  const hBuf = rw * scaleX;

                  processedFaces.push({
                    x: xBuf, y: yBuf, width: wBuf, height: hBuf,
                    trackId: Number(f.trackId ?? 0),
                    name, confidence, isMatched,
                  });
                }
              }
              return processedFaces;
            });

            logPerformance('Report to JS', () =>
              reportFacesToJS({ frameW: frame.width, frameH: frame.height, faces: out })
            );
          } catch (e: any) {
            console.error('[Worklet] FaceTrack crash:', e?.message ?? e);
          } finally {
            imageStream?.dispose?.();
            bitmap?.dispose?.();
          }
        });
      });
    },
    [resize, boxedSession, reportFacesToJS, registeredFacesMap]
  );

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.text}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission not granted (or blocked).</Text>
        <Text style={[styles.text, { marginTop: 12 }]} onPress={() => openSettings()}>
          Open Settings
        </Text>
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
    <View style={styles.mainContainer}>
      <View style={[styles.cameraContainer, { height: CAMERA_CONTAINER_HEIGHT }]}>
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isFocused && cameraInitialized}
          format={format}
          frameProcessor={frameProcessor}
          resizeMode="cover"
          onInitialized={() => setCameraInitialized(true)}
        />
        <Canvas style={StyleSheet.absoluteFill} onSize={canvasSize}>
          {boxes.map((b) => {
            let label = b.name || `ID:${b.id}`;
            if (b.isMatched && b.confidence) {
              label += ` (${(b.confidence * 100).toFixed(1)}%)`;
            }

            const boxColor = b.isMatched ? '#00FF00' : '#FF0000';
            const bgColor = b.isMatched ? 'rgba(0,255,0,0.85)' : 'rgba(255,0,0,0.85)';
            const textColor = b.isMatched ? '#000000' : '#FFFFFF';

            const padX = 6;
            const padY = 4;
            const textW = font ? font.getTextWidth(label) + padX * 2 : 120;
            const textH = font ? font.getSize() + padY * 2 + 6 : 24;
            const bgX = b.x;
            const bgY = Math.max(0, b.y - textH - 6);

            return (
              <React.Fragment key={`${b.id}-${Math.round(b.x)}-${Math.round(b.y)}`}>
                <Rect x={b.x} y={b.y} width={b.width} height={b.height} color={boxColor} style="stroke" strokeWidth={3} />
                <Rect x={bgX} y={bgY} width={textW} height={textH} color={bgColor} />
                {font && (
                  <SkiaText x={bgX + padX} y={bgY + textH - padY - 4} text={label} font={font} color={textColor} />
                )}
              </React.Fragment>
            );
          })}
          {font && (
            <React.Fragment>
              <Rect x={PREVIEW_W - 160} y={20} width={150} height={30} color="rgba(0,0,0,0.5)" />
              <SkiaText x={PREVIEW_W - 150} y={45} text={`已注册人数: ${hubFaceCount}`} font={font} color="#FFFFFF" />
            </React.Fragment>
          )}
        </Canvas>
      </View>

      <View style={[styles.infoContainer, { height: INFO_CONTAINER_HEIGHT }]}>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>识别信息</Text>
          {recognizedPerson ? (
            <View style={styles.personInfo}>
              <Text style={styles.infoText}>ID: {recognizedPerson.id}</Text>
              <Text style={styles.infoText}>姓名: {recognizedPerson.name}</Text>
              <Text style={styles.infoText}>置信度: {(recognizedPerson.confidence * 100).toFixed(1)}%</Text>
            </View>
          ) : (
            <Text style={styles.noPersonText}>等待识别...</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  cameraContainer: {
    width: '100%',
    backgroundColor: 'black',
  },
  infoContainer: {
    width: '100%',
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  infoCard: {
    width: '90%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  infoTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
    color: '#333',
  },
  personInfo: {
    flexDirection: 'column',
  },
  infoText: {
    fontSize: 16,
    marginBottom: 8,
    color: '#555',
  },
  noPersonText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#888',
    fontStyle: 'italic',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
  text: { color: 'white', fontSize: 16, marginTop: 10 },
});
