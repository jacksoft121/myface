import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { useCameraDevices, Camera, FrameProcessorPlugin, CameraPermissionStatus } from 'react-native-vision-camera'; // 导入 CameraPermissionStatus
import {
  InspireFace,
  DetectMode,
  type InspireFaceSession,
  type FaceInfo,
  type FaceFeature,
  type SearchResult,
  CameraRotation,
  ImageFormat,
} from 'react-native-nitro-inspire-face';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MMKV } from 'react-native-mmkv';
import { runOnJS } from 'react-native-reanimated'; // 导入 runOnJS

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

const faceIdMappingStorage = new MMKV({
  id: 'face-id-mapping-storage',
});
const userInfoCacheStorage = new MMKV({
  id: 'user-info-cache-storage',
});

// 辅助函数，用于显示Toast或Alert
const showToast = (message: string) => {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert(message);
  }
};

const FaceRecognitionScreen: React.FC<FaceRecognitionScreenProps> = ({ route }) => {
  const { isFront, isLiveness, faceScore, faceQuality, facePreviewSize } = route.params;

  const devices = useCameraDevices();
  console.log('Available camera devices:', devices); // 取消注释
  // 修改 cameraDevice 的获取方式
  const cameraDevice = isFront ? devices.find((d) => d.position === 'front') : devices.find((d) => d.position === 'back');
  console.log('Selected camera device:', cameraDevice); // 取消注释
  const isFocused = useIsFocused();
  const cameraRef = useRef<Camera>(null);

  const sessionRef = useRef<InspireFaceSession | null>(null);
  const [detectedFaces, setDetectedFaces] = useState<FaceInfo[]>([]);
  const [recognizedPerson, setRecognizedPerson] = useState<{ name: string; imageUrl: string } | null>(null);
  const [cameraInitialized, setCameraInitialized] = useState(false);
  // 修改状态类型为 CameraPermissionStatus
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState<CameraPermissionStatus>('not-determined');

  // 权限检查
  useEffect(() => {
    // 直接请求相机权限
    Camera.requestCameraPermission()
      .then(newStatus => {
        setCameraPermissionStatus(newStatus);
        if (newStatus !== 'granted') { // 检查是否为 'granted'
          Alert.alert('需要相机权限', '请在设置中授予相机权限以使用人脸识别功能。');
        }
      })
      .catch(error => {
        console.error('请求相机权限失败:', error);
        Alert.alert('错误', '请求相机权限失败。');
      });
  }, []); // 空数组表示只在组件挂载时运行一次

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
  const frameProcessor = useCallback((frame: any) => {
    'worklet';
    if (!sessionRef.current) {
      return;
    }

    try {
      // 创建图像流
      const imageStream = InspireFace.createImageStreamFromCameraFrame(
        frame,
        CameraRotation.ROTATION_0 // 假设相机帧已经是正确方向
      );
      imageStream.setFormat(ImageFormat.NV21); // VisionCamera 默认输出 NV21

      // 执行人脸检测
      const faces = sessionRef.current.executeFaceTrack(imageStream);
      runOnJS(setDetectedFaces)(faces); // 更新检测到的人脸

      // 如果检测到人脸，尝试进行识别
      if (faces.length > 0 && faces[0]) {
        const faceFeature = sessionRef.current.extractFaceFeature(imageStream, faces[0].token);
        if (faceFeature) {
          const searchResult = sessionRef.current.featureHubFaceSearch(faceFeature);
          if (searchResult && searchResult.length > 0 && searchResult[0].score >= faceScore / 100) {
            const bestMatch = searchResult[0];
            // 从 MMKV 中查找用户信息
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
            runOnJS(setRecognizedPerson)(foundPerson);
          } else {
            runOnJS(setRecognizedPerson)(null); // 未识别到人
          }
        }
      } else {
        runOnJS(setRecognizedPerson)(null); // 没有检测到人脸
      }

      imageStream.dispose(); // 释放图像流资源
    } catch (e) {
      console.error('Frame processor error:', e);
    }
  }, [faceScore]); // 依赖 faceScore，当其改变时重新创建 worklet

  // 根据权限状态和设备可用性渲染
  if (cameraPermissionStatus === 'not-determined') {
    return <Text style={{ margin: 20, textAlign: 'center' }}>正在请求相机权限...</Text>;
  }

  if (cameraPermissionStatus !== 'granted') { // 检查是否为 'granted'
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
          frameProcessorFps={5} // 每秒处理5帧
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
            {/* 可以根据需要显示更多信息 */}
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
    flex: 2, // 上半部分相机视图
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
    flex: 1, // 下半部分信息显示
    padding: 20,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20, // 稍微覆盖相机底部，形成视觉连接
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
