import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  Alert,
  Platform,
  ToastAndroid,
} from 'react-native';
import { useCameraDevices, Camera, CameraPermissionStatus, useFrameProcessor } from 'react-native-vision-camera';
import {
  InspireFace,
  DetectMode,
  type InspireFaceSession,
  type FaceInfo,
  CameraRotation,
  ImageFormat,
} from 'react-native-nitro-inspire-face';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MMKV } from 'react-native-mmkv';
import { runOnJS } from 'react-native-reanimated';

// 定义导航栈的参数类型
type RootStackParamList = {
  Login: undefined;
  ArcSoftInfo: undefined;
  RegisteredFaces: undefined;
  FaceRecognition: {
    isFront: boolean;
    isLiveness: boolean;
    faceScore: number;
    faceQuality: number;
    facePreviewSize: string;
  };
};

type FaceRecognitionScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'FaceRecognition'
>;

const { width, height } = Dimensions.get('window');

const recognitionStorage = new MMKV({
  id: 'recognition-params-storage',
});
const faceIdMappingStorage = new MMKV({
  id: 'face-id-mapping-storage',
});
const userInfoCacheStorage = new MMKV({
  id: 'user-info-cache-storage',
});

const RECOGNITION_PARAMS_KEY = 'recognition_params';

// 辅助函数，用于显示Toast或Alert
const showToast = (message: string) => {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert(message);
  }
};

const FaceRecognitionScreen: React.FC<FaceRecognitionScreenProps> = ({ route }) => {
  // 从 MMKV 中获取相机配置，如果不存在则使用路由参数的默认值
  const getInitialRecognitionParams = () => {
    const storedParams = recognitionStorage.getString(RECOGNITION_PARAMS_KEY);
    if (storedParams) {
      try {
        return JSON.parse(storedParams);
      } catch (e) {
        console.error('Failed to parse recognition params from MMKV', e);
        return route.params;
      }
    }
    return route.params;
  };

  const initialParams = getInitialRecognitionParams();

  const [isFront, setIsFront] = useState(initialParams.isFront);
  const [isLiveness, setIsLiveness] = useState(initialParams.isLiveness);
  const [faceScore, setFaceScore] = useState(initialParams.faceScore);
  const [faceQuality, setFaceQuality] = useState(initialParams.faceQuality);
  const [facePreviewSize, setFacePreviewSize] = useState(initialParams.facePreviewSize);

  const devices = useCameraDevices();
  const cameraDevice = isFront ? devices.find((d) => d.position === 'front') : devices.find((d) => d.position === 'back');
  const isFocused = useIsFocused();
  const cameraRef = useRef<Camera>(null);

  const sessionRef = useRef<InspireFaceSession | null>(null);
  const [detectedFaces, setDetectedFaces] = useState<FaceInfo[]>([]);
  const [recognizedPerson, setRecognizedPerson] = useState<{ name: string; imageUrl: string } | null>(null);
  const [cameraInitialized, setCameraInitialized] = useState(false);
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState<CameraPermissionStatus>('not-determined');

  // 权限检查
  useEffect(() => {
    Camera.requestCameraPermission()
      .then(newStatus => {
        setCameraPermissionStatus(newStatus);
        if (newStatus !== 'granted') {
          Alert.alert('需要相机权限', '请在设置中授予相机权限以使用人脸识别功能。');
        }
      })
      .catch(error => {
        console.error('请求相机权限失败:', error);
        Alert.alert('错误', '请求相机权限失败。');
      });
  }, []);

  // InspireFace 会话初始化和清理
  useEffect(() => {
    try {
      sessionRef.current = InspireFace.createSession(
        { enableRecognition: true },
        DetectMode.ALWAYS_DETECT,
        1, // maxDetectFaces
        -1, // minFaceSize
        -1 // maxFaceSize
      );
      console.log('InspireFace session created.');
    } catch (e) {
      Alert.alert('InspireFace 会话创建失败', (e as Error).message);
    }

    return () => {
      sessionRef.current?.dispose();
      console.log('InspireFace session disposed.');
    };
  }, []);

  // Frame Processor
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!sessionRef.current) {
      return;
    }

    try {
      const imageStream = InspireFace.createImageStreamFromCameraFrame(
        frame,
        CameraRotation.ROTATION_0
      );

      if (!imageStream) {
        return;
      }

      imageStream.setFormat(ImageFormat.NV21);

      const faces = sessionRef.current.executeFaceTrack(imageStream);

      if (!faces || !Array.isArray(faces)) {
        imageStream.dispose();
        return;
      }

      runOnJS(setDetectedFaces)(faces);

      if (faces.length > 0 && faces[0]) {
        const faceFeature = sessionRef.current.extractFaceFeature(imageStream, faces[0].token);

        if (!faceFeature) {
          runOnJS(setRecognizedPerson)(null);
          imageStream.dispose();
          return;
        }

        const searchResult = sessionRef.current.featureHubFaceSearch(faceFeature);

        if (!searchResult || !Array.isArray(searchResult)) {
          runOnJS(setRecognizedPerson)(null);
          imageStream.dispose();
          return;
        }

        if (searchResult.length > 0 && searchResult[0].score >= faceScore / 100) {
          const bestMatch = searchResult[0];
          // MMKV 操作和 setRecognizedPerson 必须在 JS 线程执行
          runOnJS(() => {
            const allKeys = faceIdMappingStorage.getAllKeys();
            let foundPerson = null;
            for (const key of allKeys) {
              if (faceIdMappingStorage.getNumber(key) === bestMatch.id) {
                const userInfoJson = userInfoCacheStorage.getString(key);
                if (userInfoJson) {
                  foundPerson = JSON.parse(userInfoJson);
                  break;
                }
              }
            }
            setRecognizedPerson(foundPerson);
          })();
        } else {
          runOnJS(setRecognizedPerson)(null);
        }
      } else {
        runOnJS(setRecognizedPerson)(null);
      }

      imageStream.dispose();
    } catch (e) {
      console.error('Frame processor error:', e);
    }
  }, [sessionRef, faceScore, setDetectedFaces, setRecognizedPerson]); // 依赖项

  if (cameraPermissionStatus === 'not-determined') {
    return <Text style={{ margin: 20, textAlign: 'center' }}>正在请求相机权限...</Text>;
  }

  if (cameraPermissionStatus !== 'granted') {
    return <Text style={{ margin: 20, textAlign: 'center' }}>相机权限已被拒绝，无法使用人脸识别功能。</Text>;
  }

  if (cameraDevice == null) {
    return <Text style={{ margin: 20, textAlign: 'center' }}>相机设备不可用</Text>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.cameraContainer}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={cameraDevice}
          isActive={isFocused && cameraInitialized}
          frameProcessor={frameProcessor}
          frameProcessorFps={5}
          onInitialized={() => setCameraInitialized(true)}
        />
        {detectedFaces.map((face, index) => (
          <View
            key={index}
            style={[
              styles.faceBox,
              {
                left: face.rect.left,
                top: face.rect.top,
                width: face.rect.width,
                height: face.rect.height,
              },
            ]}
          >
            {recognizedPerson && (
              <Text style={styles.faceName}>{recognizedPerson.name}</Text>
            )}
          </View>
        ))}
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.infoTitle}>识别信息</Text>
        {recognizedPerson ? (
          <View>
            <Text style={styles.infoText}>姓名: {recognizedPerson.name}</Text>
            <Text style={styles.infoText}>图片URL: {recognizedPerson.imageUrl}</Text>
          </View>
        ) : (
          <Text style={styles.infoText}>等待识别...</Text>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  cameraContainer: {
    flex: 2,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'red',
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 2,
  },
  faceName: {
    color: 'white',
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  infoContainer: {
    flex: 1,
    padding: 20,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  infoTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 16,
    marginBottom: 5,
  },
});

export default FaceRecognitionScreen;
