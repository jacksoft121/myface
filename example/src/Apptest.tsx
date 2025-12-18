import { Image, StyleSheet, View } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import {
  AssetManager,
  CameraRotation,
  DetectMode,
  ImageFormat,
  InspireFace,
  PrimaryKeyMode,
  SearchMode,
  type FaceFeatureIdentity,
  type SessionCustomParameter,
  type Face,
} from 'react-native-nitro-inspire-face';
import { useEffect } from 'react';
import { Camera, useCameraDevices, CameraPermissionStatus } from 'react-native-vision-camera';
import { launchImageLibrary } from 'react-native-image-picker';
import { MMKV } from 'react-native-mmkv';
import RNFS from 'react-native-fs';

// 初始化 MMKV
const storage = new MMKV({
  id: 'user-faces-storage',
});

// 初始化特征库配置
InspireFace.featureHubDataEnable({
  enablePersistence: false,
  enablePersistence: true, // 开启特征持久化
  persistenceDbPath: 'bob.db',
  searchThreshold: 0.42,
  searchMode: SearchMode.EXHAUSTIVE,
  primaryKeyMode: PrimaryKeyMode.AUTO_INCREMENT,
});
InspireFace.featureHubFaceSearchThresholdSetting(0.42);
InspireFace.launch('Pikachu');

AssetManager.copyAssetToFile(
  'kun.jpg',
  `${AssetManager.getFilesDirectory()}/kun.jpg`
);
// 定义人脸数据接口
interface FaceData {
  id: number;
  name: string;
  confidence?: number;
  timestamp: number;
  imageUri: string;
}

interface FaceBox extends Face {
  name?: string;
  color: string;
}

const { width: screenWidth } = Dimensions.get('window');
const PREVIEW_WIDTH = screenWidth - 40;
const PREVIEW_HEIGHT = 300;

export default function App() {
  const [activeTab, setActiveTab] = useState('photoRegister');
  const [name, setName] = useState('');
  const [registeredFaces, setRegisteredFaces] = useState<FaceData[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [recognitionResult, setRecognitionResult] = useState<string>('');
  const [cameraType, setCameraType] = useState<'front' | 'back'>('front');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [realTimeResult, setRealTimeResult] = useState<string>('');
  const [session, setSession] = useState<any>(null);
  const [cameraPermission, setCameraPermission] = useState<CameraPermissionStatus>();
  const [faceBoxes, setFaceBoxes] = useState<FaceBox[]>([]);

  const cameraRef = useRef<Camera>(null);
  const devices = useCameraDevices();
  const device = devices.find((d) => d.position === cameraType);

  // 应用启动时加载持久化数据
  useEffect(() => {
    Camera.requestCameraPermission().then(setCameraPermission);
    const jsonString = storage.getString('registeredFaces');
    if (jsonString) {
      setRegisteredFaces(JSON.parse(jsonString));
    }
  }, []);

  // 当人脸列表变化时，保存到MMKV
  useEffect(() => {
    storage.set('registeredFaces', JSON.stringify(registeredFaces));
  }, [registeredFaces]);

  // 初始化人脸检测会话
  useEffect(() => {
    const initFaceDetection = () => {
      if (cameraPermission !== 'granted') return;
      const initSession = () => {
        try {
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
          session.setFilterMinimumFacePixelSize(0);

          for (let j = 0; j < 1; j++) {
            const bitmap = InspireFace.createImageBitmapFromFilePath(
              3,
              `${AssetManager.getFilesDirectory()}/kun.jpg`
            );
            const imageStream = InspireFace.createImageStreamFromBitmap(
              bitmap,
              CameraRotation.ROTATION_90
            );
            imageStream.setFormat(ImageFormat.BGR);
            imageStream.setRotation(CameraRotation.ROTATION_0);
            const multipleFaceData = session.executeFaceTrack(imageStream);
            console.log('multipleFaceData', multipleFaceData.length);
            if (multipleFaceData.length > 0 && multipleFaceData[0]) {
              console.log(multipleFaceData[0].rect);
              const lmk = InspireFace.getFaceDenseLandmarkFromFaceToken(
                multipleFaceData[0].token
              );
              console.log('lmk', lmk.length);
              const feature = session.extractFaceFeature(
                imageStream,
                multipleFaceData[0].token
              );
              for (let i = 0; i < 10; i++) {
                const result = InspireFace.featureHubFaceInsert({
                  id: -1,
                  feature,
                });
                console.log('result', result);
              }
              console.log('Feature size: ', feature.byteLength);
              const searched = InspireFace.featureHubFaceSearch(feature);
              if (searched) {
                console.log(
                  'searched',
                  searched.id,
                  'confidence',
                  searched.confidence
                );
              }
              const topKResults = InspireFace.featureHubFaceSearchTopK(
                feature,
                10
              );
              console.log('topKResults', topKResults.length);
              topKResults.forEach((result) => {
                console.log(
                  'TopK id: ',
                  result.id,
                  'Confidence: ',
                  result.confidence
                );
              });
              // const newFeature = new Array(InspireFace.featureLength).fill(0);
              const newFeature = new Float32Array(InspireFace.featureLength)
                .buffer;

              const identity: FaceFeatureIdentity = {
                id: 8,
                feature: newFeature,
              };
              const updateSuccess = InspireFace.featureHubFaceUpdate(identity);
              if (updateSuccess) {
                console.log('Update feature success: ' + 8);
              } else {
                console.log('Update feature failed: ' + 8);
                const newSession = InspireFace.createSession(
                  { enableRecognition: true, enableFaceQuality: true, enableFaceAttribute: true, enableInteractionLiveness: true, enableLiveness: true, enableMaskDetect: true },
                  DetectMode.ALWAYS_DETECT, 10, -1, -1
                );
                newSession.setTrackPreviewSize(320);
                newSession.setFaceDetectThreshold(0.5);
                newSession.setFilterMinimumFacePixelSize(0);
                setSession(newSession);
              } catch (error) {
                console.error('初始化会话失败:', error);
              }
            };
            initSession();
            return () => { if (session) session.dispose(); };
          }, [cameraPermission]);

          const selectImageFromGallery = async () => {
            try {
              const result = await launchImageLibrary({
                mediaType: 'photo',
                quality: 0.8,
              });

              if (result.assets && result.assets[0]) {
                setSelectedImage(result.assets[0].uri || null);
              }
            } catch (error) {
              Alert.alert('错误', '选择图片失败');
            }
          };

          const saveImagePermanently = async (tempUri: string): Promise<string> => {
            const fileName = tempUri.split('/').pop();
            const destPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
            await RNFS.copyFile(tempUri.replace('file://', ''), destPath);
            return `file://${destPath}`;
          };

          const handlePhotoRegister = async () => {
            if (!selectedImage || !name.trim()) {
              Alert.alert('提示', '请选择图片并输入姓名');
              return;
            }
            try {
              const permanentUri = await saveImagePermanently(selectedImage);
              const bitmap = InspireFace.createImageBitmapFromFilePath(3, permanentUri.replace('file://', ''));
              const imageStream = InspireFace.createImageStreamFromBitmap(bitmap, CameraRotation.ROTATION_0);
              imageStream.setFormat(ImageFormat.BGR);
              const multipleFaceData = session.executeFaceTrack(imageStream);
              if (multipleFaceData.length === 0) {
                Alert.alert('提示', '未检测到人脸');
                return;
              }
              const feature = session.extractFaceFeature(imageStream, multipleFaceData[0].token);
              const result = InspireFace.featureHubFaceInsert({ id: -1, feature });
              if (result) {
                const newFace: FaceData = { id: result, name: name.trim(), timestamp: Date.now(), imageUri: permanentUri };
                setRegisteredFaces(prev => [...prev, newFace]);
                setName('');
                setSelectedImage(null);
                Alert.alert('成功', `人脸录入成功！ID: ${result}`);
              }
              imageStream.dispose();
              bitmap.dispose();
            } catch (error) {
              Alert.alert('错误', '人脸录入失败');
            }
          };

          const handleCameraRegister = async () => {
            if (!name.trim()) {
              Alert.alert('提示', '请输入姓名');
              return;
            }
            try {
              if (cameraRef.current) {
                const photo = await cameraRef.current.takePhoto({ flash: 'off' });
                if (photo.path) {
                  const permanentUri = await saveImagePermanently(`file://${photo.path}`);
                  const bitmap = InspireFace.createImageBitmapFromFilePath(3, permanentUri.replace('file://', ''));
                  const imageStream = InspireFace.createImageStreamFromBitmap(bitmap, CameraRotation.ROTATION_0);
                  imageStream.setFormat(ImageFormat.BGR);
                  const multipleFaceData = session.executeFaceTrack(imageStream);
                  if (multipleFaceData.length === 0) {
                    Alert.alert('提示', '未检测到人脸');
                    return;
                  }
                  const feature = session.extractFaceFeature(imageStream, multipleFaceData[0].token);
                  const result = InspireFace.featureHubFaceInsert({ id: -1, feature });
                  if (result) {
                    const newFace: FaceData = { id: result, name: name.trim(), timestamp: Date.now(), imageUri: permanentUri };
                    setRegisteredFaces(prev => [...prev, newFace]);
                    setName('');
                    Alert.alert('成功', `摄像头录入成功！ID: ${result}`);
                  }
                  imageStream.dispose();
                  bitmap.dispose();
                }
              }
            } catch (error) {
              Alert.alert('错误', '摄像头录入失败');
            }
          };

          const handlePhotoRecognition = async () => {
            try {
              const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
              if (result.assets && result.assets[0] && result.assets[0].uri) {
                const imageUri = result.assets[0].uri;
                setSelectedImage(imageUri);
                const bitmap = InspireFace.createImageBitmapFromFilePath(3, imageUri.replace('file://', ''));
                const imageStream = InspireFace.createImageStreamFromBitmap(bitmap, CameraRotation.ROTATION_0);
                imageStream.setFormat(ImageFormat.BGR);
                const multipleFaceData = session.executeFaceTrack(imageStream);
                if (multipleFaceData.length === 0) {
                  setRecognitionResult('未检测到人脸');
                  return;
                }
                const feature = session.extractFaceFeature(imageStream, multipleFaceData[0].token);
                const searched = InspireFace.featureHubFaceSearch(feature);
                if (searched && searched.confidence && searched.confidence > 0.6) {
                  const face = registeredFaces.find(f => f.id === searched.id);
                  setRecognitionResult(face ? `识别成功：${face.name} (置信度: ${(searched.confidence * 100).toFixed(2)}%)` : `识别到未知人脸 ID: ${searched.id} (置信度: ${(searched.confidence * 100).toFixed(2)}%)`);
                } else {
                  setRecognitionResult('未识别到已注册的人脸');
                }
                imageStream.dispose();
                bitmap.dispose();
              }
            } catch (error) {
              setRecognitionResult('识别失败');
            }
          };

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
            if (!isCameraActive || !cameraRef.current) return;
            try {
              const photo = await cameraRef.current.takeSnapshot({ quality: 85 });
              if (photo.path) {
                const bitmap = InspireFace.createImageBitmapFromFilePath(3, photo.path);
                const imageStream = InspireFace.createImageStreamFromBitmap(bitmap, CameraRotation.ROTATION_0);
                imageStream.setFormat(ImageFormat.BGR);
                const multipleFaceData = session.executeFaceTrack(imageStream);
                if (multipleFaceData.length > 0) {
                  const newFaceBoxes: FaceBox[] = [];
                  let resultText = '检测到人脸，但未识别';
                  for (const face of multipleFaceData) {
                    const feature = session.extractFaceFeature(imageStream, face.token);
                    const searched = InspireFace.featureHubFaceSearch(feature);
                    let name = 'Unknown';
                    let color = '#FF0000';
                    if (searched && searched.confidence && searched.confidence > 0.6) {
                      const registeredFace = registeredFaces.find(f => f.id === searched.id);
                      if (registeredFace) {
                        name = registeredFace.name;
                        color = '#00FF00';
                        resultText = `识别到：${name} (${(searched.confidence * 100).toFixed(1)}%)`;
                      }
                    }
                    const removeSuccess = InspireFace.featureHubFaceRemove(4);
                    if (removeSuccess) {
                      console.log('Remove feature success: ' + 4);
                      const imageAspectRatio = photo.width / photo.height;
                      const previewAspectRatio = PREVIEW_WIDTH / PREVIEW_HEIGHT;
                      let scale, offsetX = 0, offsetY = 0;
                      if (imageAspectRatio > previewAspectRatio) {
                        scale = PREVIEW_HEIGHT / photo.height;
                        offsetX = ((photo.width * scale) - PREVIEW_WIDTH) / 2;
                      } else {
                        console.log('Remove feature failed: ' + 4);
                        scale = PREVIEW_WIDTH / photo.width;
                        offsetY = ((photo.height * scale) - PREVIEW_HEIGHT) / 2;
                      }
                      const topkAgn = InspireFace.featureHubFaceSearchTopK(feature, 10);
                      topkAgn.forEach((result) => {
                        console.log(
                          'Agn TopK id:',
                          result.id,
                          'Confidence: ',
                          result.confidence
                        );
                      });
                      const start = performance.now();
                      let queryIdentity = InspireFace.featureHubGetFaceIdentity(4);
                      if (queryIdentity) {
                        console.log('Query identity: ', queryIdentity.id);
                      } else {
                        console.log('Query identity failed');
                      }
                      queryIdentity = InspireFace.featureHubGetFaceIdentity(2);
                      if (queryIdentity) {
                        console.log('strFt', queryIdentity.feature.byteLength);
                        console.log('query id: ', queryIdentity.id);
                        const comp = InspireFace.faceComparison(
                          queryIdentity.feature,
                          feature
                        );
                        console.log('comp', comp);
                      } else {
                        console.log('Query identity failed');
                      }
                      const pipelineNeedParam: SessionCustomParameter = {
                        enableFaceQuality: true,
                        enableLiveness: true,
                        enableMaskDetect: true,
                        enableFaceAttribute: true,
                        enableInteractionLiveness: true,
                      };
                      const succPipe = session.multipleFacePipelineProcess(
                        imageStream,
                        multipleFaceData,
                        pipelineNeedParam
                      );
                      if (succPipe) {
                        console.log('pipeline success');
                        const rgbLivenessConfidence = session.getRGBLivenessConfidence();
                        console.log('rgbLivenessConfidence', rgbLivenessConfidence);
                        const faceQualityConfidence = session.getFaceQualityConfidence();
                        console.log('faceQualityConfidence', faceQualityConfidence);
                        const faceMaskConfidence = session.getFaceMaskConfidence();
                        console.log('faceMaskConfidence', faceMaskConfidence);
                        const faceInteractionState = session.getFaceInteractionState();
                        console.log('faceInteractionState', faceInteractionState);
                        const faceInteractionActionsResult =
                          session.getFaceInteractionActionsResult();
                        console.log(
                          'faceInteractionActionsResult',
                          faceInteractionActionsResult
                        );
                        const faceAttributeResult = session.getFaceAttributeResult();
                        console.log('faceAttributeResult', faceAttributeResult);
                      }
                      const end = performance.now();
                      console.log(`Time taken: ${end - start} milliseconds`);
                      const imageStream1 = InspireFace.createImageStreamFromBitmap(
                        session.getFaceAlignmentImage(
                          imageStream,
                          multipleFaceData[0].token
                        ),
                        CameraRotation.ROTATION_0
                      );
                      imageStream1.writeImageToFile(
                        `${AssetManager.getFilesDirectory()}/kun_circle.jpg`
                      );
                    }
                    // const imageBitmap = imageStream.createImageBitmap(false, 1);
                    // imageBitmap.drawRect(
                    //   { x: 100, y: 100, width: 100, height: 100 },
                    //   { r: 255, g: 0, b: 0 },
                    //   4
                    // );
                    // imageBitmap.drawCircle(
                    //   { x: 150, y: 100 },
                    //   200,
                    //   { r: 0, g: 255, b: 0 },
                    //   20
                    // );
                    // imageBitmap.writeToFile(
                    //   `${AssetManager.getFilesDirectory()}/kun_circle1.jpg`
                    // );

                    // InspireFace.
                    // console.log('imageBitmap', imageBitmap.width);

                    // InspireFace.setAppleCoreMLInferenceMode(AppleCoreMLInferenceMode.CPU);

                    console.log(InspireFace.getRecommendedCosineThreshold());

                    imageStream.dispose();
                    bitmap.dispose();
                  }
                  session.dispose();
                } catch (err) {
                  console.log('err', err);
                  newFaceBoxes.push({ ...face, rect: { x: face.rect.x * scale - offsetX, y: face.rect.y * scale - offsetY, width: face.rect.width * scale, height: face.rect.height * scale }, name, color });
                }
                setFaceBoxes(newFaceBoxes);
                setRealTimeResult(resultText);
              } else {
                setRealTimeResult('未检测到人脸');
                setFaceBoxes([]);
              }
              imageStream.dispose();
              bitmap.dispose();
            }
          } catch (error) {
            console.error('实时识别错误:', error);
          }
          if (isCameraActive) {
            setTimeout(processRealTimeFrame, 500);
          }
        };

        const handleDeleteFace = (id: number) => {
          Alert.alert("确认删除", "你确定要删除这张人脸吗？", [
            { text: "取消", style: "cancel" },
            {
              text: "删除",
              onPress: async () => {
                const faceToDelete = registeredFaces.find(face => face.id === id);
                if (faceToDelete) {
                  try {
                    await RNFS.unlink(faceToDelete.imageUri.replace('file://', ''));
                  } catch (error) {
                    console.error("删除图片文件失败:", error);
                  }
                }
                const result = InspireFace.featureHubFaceRemove(id);
                if (result === 0) {
                  setRegisteredFaces(prev => prev.filter(face => face.id !== id));
                  Alert.alert('成功', '人脸已删除');
                } else {
                  Alert.alert('失败', '删除人脸失败');
                }
              },
              style: "destructive"
            }
        };
        initFaceDetection();
      }, []);
    ]);
    };

    useEffect(() => {
      const run = async () => { if (isCameraActive) await processRealTimeFrame(); };
      run().catch(console.error);
    }, [isCameraActive]);

    const toggleCamera = () => setCameraType(prev => prev === 'front' ? 'back' : 'front');

    if (cameraPermission !== 'granted') {
      return <View style={styles.container}><Text style={{ margin: 20, textAlign: 'center' }}>{cameraPermission == null ? 'Requesting camera permission...' : 'Camera permission denied. Please grant permission in settings.'}</Text></View>;
    }
    if (!device) {
      return <View style={styles.container}><Text style={{ margin: 20, textAlign: 'center' }}>No camera device found.</Text></View>;
    }

    const renderTabContent = () => {
      switch (activeTab) {
        case 'photoRegister':
          return (
            <View style={styles.tabContent}>
              <Text style={styles.title}>图片人脸录入</Text>
              <TouchableOpacity style={styles.button} onPress={selectImageFromGallery}><Text style={styles.buttonText}>选择图片</Text></TouchableOpacity>
              {selectedImage && <Image source={{ uri: selectedImage }} style={styles.previewImage} />}
              <TextInput style={styles.input} placeholder="输入姓名" value={name} onChangeText={setName} />
              <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={handlePhotoRegister}><Text style={styles.buttonText}>提交保存</Text></TouchableOpacity>
              {registeredFaces.length > 0 && (
                <View style={styles.registeredList}>
                  <Text style={styles.listTitle}>已注册人脸 ({registeredFaces.length})</Text>
                  {registeredFaces.map(face => (
                    <View key={face.id} style={styles.faceItem}>
                      <Image source={{ uri: face.imageUri }} style={styles.faceImage} />
                      <View style={styles.faceInfo}>
                        <Text style={styles.faceName}>ID: {face.id} - {face.name}</Text>
                        <Text style={styles.faceTime}>{new Date(face.timestamp).toLocaleString()}</Text>
                      </View>
                      <TouchableOpacity onPress={() => handleDeleteFace(face.id)} style={styles.deleteButton}><Text style={styles.deleteButtonText}>删除</Text></TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        // Other cases...
        case 'cameraRegister':
          return (
            <View style={styles.tabContent}>
              <Text style={styles.title}>摄像头人脸录入</Text>
              <View style={styles.cameraContainer}>
                {device && <Camera ref={cameraRef} style={styles.camera} device={device} isActive={!isCameraActive} photo={true} />}
                <View style={styles.cameraControls}><TouchableOpacity style={styles.cameraButton} onPress={toggleCamera}><Text style={styles.cameraButtonText}>切换摄像头</Text></TouchableOpacity></View>
              </View>
              <TextInput style={styles.input} placeholder="输入姓名" value={name} onChangeText={setName} />
              <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={handleCameraRegister}><Text style={styles.buttonText}>拍照并保存</Text></TouchableOpacity>
            </View>
          );
        case 'photoRecognition':
          return (
            <View style={styles.tabContent}>
              <Text style={styles.title}>图片人脸识别</Text>
              <TouchableOpacity style={styles.button} onPress={handlePhotoRecognition}><Text style={styles.buttonText}>选择识别图片</Text></TouchableOpacity>
              {selectedImage && <Image source={{ uri: selectedImage }} style={styles.previewImage} />}
              {recognitionResult ? <View style={styles.resultContainer}><Text style={styles.resultText}>{recognitionResult}</Text></View> : null}
            </View>
          );
        case 'realTimeRecognition':
          return (
            <View style={styles.tabContent}>
              <Text style={styles.title}>实时人脸识别</Text>
              <View style={styles.cameraContainer}>
                {device && <Camera ref={cameraRef} style={styles.camera} device={device} isActive={isCameraActive} photo={true} />}
                {faceBoxes.map((box, index) => (
                  <View key={index} style={[styles.faceBox, { left: box.rect.x, top: box.rect.y, width: box.rect.width, height: box.rect.height, borderColor: box.color }]}>
                    <Text style={[styles.faceBoxName, { backgroundColor: box.color }]}>{box.name}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.cameraControls}>
                <TouchableOpacity style={styles.cameraButton} onPress={toggleCamera}><Text style={styles.cameraButtonText}>切换摄像头</Text></TouchableOpacity>
                {!isCameraActive ? <TouchableOpacity style={[styles.cameraButton, styles.primaryButton]} onPress={startRealTimeRecognition}><Text style={styles.cameraButtonText}>开始识别</Text></TouchableOpacity> : <TouchableOpacity style={[styles.cameraButton, styles.dangerButton]} onPress={stopRealTimeRecognition}><Text style={styles.cameraButtonText}>停止识别</Text></TouchableOpacity>}
              </View>
              {realTimeResult ? <View style={styles.resultContainer}><Text style={styles.resultText}>{realTimeResult}</Text></View> : null}
            </View>
          );
        default:
          return null;
      }
    };

    return (
      <View style={styles.container}>
        <Image
          source={{
            uri: `file://${AssetManager.getFilesDirectory()}/kun_circle.jpg`,
          }}
          style={{ width: 200, height: 300 }}
        />
        <View style={styles.tabBar}>
          <TouchableOpacity style={[styles.tab, activeTab === 'photoRegister' && styles.activeTab]} onPress={() => setActiveTab('photoRegister')}><Text style={styles.tabText}>图片录入</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'cameraRegister' && styles.activeTab]} onPress={() => setActiveTab('cameraRegister')}><Text style={styles.tabText}>摄像头录入</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'photoRecognition' && styles.activeTab]} onPress={() => setActiveTab('photoRecognition')}><Text style={styles.tabText}>图片识别</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'realTimeRecognition' && styles.activeTab]} onPress={() => setActiveTab('realTimeRecognition')}><Text style={styles.tabText}>实时识别</Text></TouchableOpacity>
        </View>
        <ScrollView style={styles.content}>{renderTabContent()}</ScrollView>
      </View>
    );
  }

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    error: {
      color: 'red',
      marginTop: 10,
    },
    container: { flex: 1, backgroundColor: '#f5f5f5', justifyContent: 'center' },
    tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ddd' },
    tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
    activeTab: { borderBottomWidth: 2, borderBottomColor: '#007AFF' },
    tabText: { fontSize: 14, color: '#333' },
    content: { flex: 1 },
    tabContent: { padding: 20 },
    title: { fontSize: 18, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
    input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 15, backgroundColor: '#fff' },
    button: { backgroundColor: '#e0e0e0', padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
    primaryButton: { backgroundColor: '#007AFF' },
    dangerButton: { backgroundColor: '#FF3B30' },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    previewImage: { width: 200, height: 200, alignSelf: 'center', marginVertical: 15, borderRadius: 8 },
    cameraContainer: { height: PREVIEW_HEIGHT, marginBottom: 15, position: 'relative' },
    camera: { flex: 1, borderRadius: 8 },
    cameraControls: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10 },
    cameraButton: { backgroundColor: '#e0e0e0', padding: 10, borderRadius: 6, minWidth: 100, alignItems: 'center' },
    cameraButtonText: { color: '#333', fontSize: 14 },
    resultContainer: { backgroundColor: '#fff', padding: 15, borderRadius: 8, marginTop: 15, borderLeftWidth: 4, borderLeftColor: '#007AFF' },
    resultText: { fontSize: 16, color: '#333' },
    registeredList: { marginTop: 20, padding: 20, backgroundColor: '#fff' },
    listTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
    faceItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
    faceImage: { width: 50, height: 50, borderRadius: 25, marginRight: 15 },
    faceInfo: { flex: 1 },
    faceName: { fontSize: 14, fontWeight: '600' },
    faceTime: { fontSize: 12, color: '#666', marginTop: 2 },
    deleteButton: { backgroundColor: '#FF3B30', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 6 },
    deleteButtonText: { color: '#fff', fontSize: 12 },
    faceBox: { position: 'absolute', borderWidth: 2, borderRadius: 4 },
    faceBoxName: { position: 'absolute', top: -20, left: 0, color: '#fff', fontSize: 12, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 2 },
  });

