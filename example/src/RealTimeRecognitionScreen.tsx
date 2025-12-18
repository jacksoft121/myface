import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
} from 'react-native';
import {
  Camera,
  useCameraDevices,
  CameraPermissionStatus,
} from 'react-native-vision-camera';
import { useIsFocused, useFocusEffect } from '@react-navigation/native';
import {
  InspireFace,
  CameraRotation,
  ImageFormat,
  DetectMode,
  type Face,
} from 'react-native-nitro-inspire-face';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({
  id: 'user-faces-storage',
});

interface FaceBox extends Face {
  name?: string;
  color: string;
}

const { width: screenWidth } = Dimensions.get('window');
const PREVIEW_WIDTH = screenWidth;
const PREVIEW_HEIGHT = Dimensions.get('window').height;

export default function RealTimeRecognitionScreen({ navigation }) {
  const [cameraPermission, setCameraPermission] = useState<CameraPermissionStatus>();
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [realTimeResult, setRealTimeResult] = useState<string>('');
  const [faceBoxes, setFaceBoxes] = useState<FaceBox[]>([]);
  const [cameraType, setCameraType] = useState<'front' | 'back'>('front');
  const [session, setSession] = useState<any>(null);
  const [registeredFaces, setRegisteredFaces] = useState<any[]>([]);


  const cameraRef = useRef<Camera>(null);
  const devices = useCameraDevices();
  const device = devices.find((d) => d.position === cameraType);
  const isFocused = useIsFocused();

  useFocusEffect(
    useCallback(() => {
      Camera.requestCameraPermission().then(setCameraPermission);
    }, [])
  );

  useEffect(() => {
    const jsonString = storage.getString('registeredFaces');
    if (jsonString) {
      setRegisteredFaces(JSON.parse(jsonString));
    }
  }, []);

  useEffect(() => {
    if (cameraPermission === 'granted' && isFocused) {
      const newSession = InspireFace.createSession(
        {
          enableRecognition: true,
          enableLiveness: true,
        },
        DetectMode.ALWAYS_DETECT,
        10,
        -1,
        -1
      );
      setSession(newSession);
      return () => {
        if (newSession) {
          newSession.dispose();
        }
      };
    }
  }, [cameraPermission, isFocused]);

  const startRealTimeRecognition = () => {
    setIsCameraActive(true);
    setRealTimeResult('开始实时识别...');
  };

  const stopRealTimeRecognition = () => {
    setIsCameraActive(false);
    setRealTimeResult('');
    setFaceBoxes([]);
  };

  const processRealTimeFrame = async () => {
    if (!isCameraActive || !cameraRef.current || !session) return;
    try {
      const photo = await cameraRef.current.takeSnapshot({ quality: 85 });
      if (photo.path) {
        const bitmap = InspireFace.createImageBitmapFromFilePath(3, photo.path);
        const imageStream = InspireFace.createImageStreamFromBitmap(
          bitmap,
          CameraRotation.ROTATION_0
        );
        imageStream.setFormat(ImageFormat.BGR);
        const multipleFaceData = session.executeFaceTrack(imageStream);
        const newFaceBoxes: FaceBox[] = [];
        let resultText = '未检测到人脸';

        if (multipleFaceData.length > 0) {
          resultText = `检测到 ${multipleFaceData.length} 张人脸，但未识别`;
          for (const face of multipleFaceData) {
            const feature = session.extractFaceFeature(imageStream, face.token);
            const searched = InspireFace.featureHubFaceSearch(feature);
            let name = 'Unknown';
            let color = '#FF0000';
            if (searched && searched.confidence && searched.confidence > 0.6) {
              const registeredFace = registeredFaces.find(
                (f) => f.id === searched.id
              );
              if (registeredFace) {
                name = registeredFace.name;
                color = '#00FF00';
                resultText = `识别到：${name} (${(
                  searched.confidence * 100
                ).toFixed(1)}%)`;
              }
            }
            const imageAspectRatio = photo.width / photo.height;
            const previewAspectRatio = PREVIEW_WIDTH / PREVIEW_HEIGHT;
            let scale,
              offsetX = 0,
              offsetY = 0;
            if (imageAspectRatio > previewAspectRatio) {
              scale = PREVIEW_HEIGHT / photo.height;
              offsetX = (photo.width * scale - PREVIEW_WIDTH) / 2;
            } else {
              scale = PREVIEW_WIDTH / photo.width;
              offsetY = (photo.height * scale - PREVIEW_HEIGHT) / 2;
            }
            newFaceBoxes.push({
              ...face,
              rect: {
                x: face.rect.x * scale - offsetX,
                y: face.rect.y * scale - offsetY,
                width: face.rect.width * scale,
                height: face.rect.height * scale,
              },
              name,
              color,
            });
          }
        }
        setFaceBoxes(newFaceBoxes);
        setRealTimeResult(resultText);
        imageStream.dispose();
        bitmap.dispose();
      }
    } catch (error) {
      console.error('实时识别错误:', error);
    } finally {
      if (isCameraActive) {
        setTimeout(processRealTimeFrame, 500);
      }
    }
  };

  useEffect(() => {
    if (isCameraActive) {
      processRealTimeFrame();
    }
  }, [isCameraActive]);

  const toggleCamera = () =>
    setCameraType((prev) => (prev === 'front' ? 'back' : 'front'));

  if (cameraPermission !== 'granted') {
    return (
      <View style={styles.container}>
        <Text style={{ margin: 20, textAlign: 'center' }}>
          {cameraPermission == null
            ? 'Requesting camera permission...'
            : 'Camera permission denied. Please grant permission in settings.'}
        </Text>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={{ margin: 20, textAlign: 'center' }}>
          No camera device found.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>实时人脸识别</Text>
      <View style={styles.cameraContainer}>
        {device && (
          <Camera
            ref={cameraRef}
            style={styles.camera}
            device={device}
            isActive={isFocused && isCameraActive}
            photo={true}
          />
        )}
        {faceBoxes.map((box, index) => (
          <View
            key={index}
            style={[
              styles.faceBox,
              {
                left: box.rect.x,
                top: box.rect.y,
                width: box.rect.width,
                height: box.rect.height,
                borderColor: box.color,
              },
            ]}
          >
            <Text style={[styles.faceBoxName, { backgroundColor: box.color }]}>
              {box.name}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.cameraControls}>
        <TouchableOpacity style={styles.cameraButton} onPress={toggleCamera}>
          <Text style={styles.cameraButtonText}>切换摄像头</Text>
        </TouchableOpacity>
        {!isCameraActive ? (
          <TouchableOpacity
            style={[styles.cameraButton, styles.primaryButton]}
            onPress={startRealTimeRecognition}
          >
            <Text style={styles.cameraButtonText}>开始识别</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.cameraButton, styles.dangerButton]}
            onPress={stopRealTimeRecognition}
          >
            <Text style={styles.cameraButtonText}>停止识别</Text>
          </TouchableOpacity>
        )}
      </View>
      {realTimeResult ? (
        <View style={styles.resultContainer}>
          <Text style={styles.resultText}>{realTimeResult}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 20,
    textAlign: 'center',
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  cameraControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cameraButton: {
    backgroundColor: '#e0e0e0',
    padding: 10,
    borderRadius: 6,
    minWidth: 100,
    alignItems: 'center',
  },
  cameraButtonText: { color: '#333', fontSize: 14 },
  primaryButton: { backgroundColor: '#007AFF' },
  dangerButton: { backgroundColor: '#FF3B30' },
  resultContainer: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 15,
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    borderRadius: 8,
  },
  resultText: { fontSize: 16, color: '#fff', textAlign: 'center' },
  faceBox: { position: 'absolute', borderWidth: 2, borderRadius: 4 },
  faceBoxName: {
    position: 'absolute',
    top: -20,
    left: 0,
    color: '#fff',
    fontSize: 12,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
});
