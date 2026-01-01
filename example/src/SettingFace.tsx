import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Button,
  Alert,
  TextInput,
  Platform,
  ToastAndroid,
  Modal,
  FlatList,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import Clipboard from '@react-native-clipboard/clipboard';
import { apiFind } from './api';
import {
  InspireFace,
  DetectMode,
  type InspireFaceSession,
  CameraRotation,
  ImageFormat,
} from 'react-native-nitro-inspire-face';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {getCurrentUser, setCurrentUser, type User} from './comm/User';
import { recognitionStorage } from './comm/GlobalStorage';
import {
  insertName,
  queryUsersByOrgId,
  deleteUsersByOrgId,
  updateDlxUserByFaceId,
} from './comm/FaceDB';
import { FaceRegistrationService } from './comm/FaceRegistrationService';

const RECOGNITION_PARAMS_KEY = 'recognition_params';

type RecognitionParams = {
  isFront: boolean;
  isLiveness: boolean;
  faceScore: number;
  faceQuality: number;
  facePreviewSize: string;
  faceConfidenceThreshold: number;
  cameraMode: 'contain' | 'cover';
  frameProcessorFPS: number;
};

type Campus = {
  ID: number;
  VCNAME: string;
};

type OutDataInfo = {
  data2: Array<{
    VCNAME: string;
    ISQD: string;
    DTQDS: string;
    DTQDE: string;
    ISQT: string;
    DTQTS: string;
    DTQTE: string;
  }>;
};

type LogEntry = {
  text: string;
  type: 'log' | 'error' | 'success';
};

const SettingFace = ({ route }: any) => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const [idtype, setIdtype] = useState(0);
  const [typetext, setTypetext] = useState('');
  const [outDataInfo, setOutDataInfo] = useState<OutDataInfo>({ data2: [] });
  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null);
  const [campusList, setCampusList] = useState<Campus[]>([]);
  const [isCampusModalVisible, setCampusModalVisible] = useState(false);
  const [isBeginFace, setIsBeginFace] = useState(true);
  const [isProgressVisible, setProgressVisible] = useState(false);
  const [isProgressComplete, setProgressComplete] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressLog, setProgressLog] = useState<LogEntry[]>([]);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressFailed, setProgressFailed] = useState(0);
  const [elapsedTime, setElapsedTime] = useState('');
  const progressScrollViewRef = useRef<any>(null);
  const sessionRef = useRef<InspireFaceSession | null>(null);

  // 新增的状态变量
  const [isFront, setIsFront] = useState(true);
  const [isLiveness, setIsLiveness] = useState(true);
  const [faceScore, setFaceScore] = useState(70);
  const [faceQuality, setFaceQuality] = useState(70);
  const [facePreviewSize, setFacePreviewSize] = useState('');
  const [faceConfidenceThreshold, setFaceConfidenceThreshold] = useState(70);
  const [cameraMode, setCameraMode] = useState<'contain' | 'cover'>('contain');
  const [frameProcessorFPS, setFrameProcessorFPS] = useState(30);

  const loadInitialRecognitionParams = useCallback(async () => {
    const cachedParams = recognitionStorage.getString(RECOGNITION_PARAMS_KEY);
    if (cachedParams) {
      try {
        const params: RecognitionParams = JSON.parse(cachedParams);
        setIsFront(params.isFront);
        setIsLiveness(params.isLiveness);
        setFaceScore(params.faceScore);
        setFaceQuality(params.faceQuality);
        setFacePreviewSize(params.facePreviewSize);
        setFaceConfidenceThreshold(params.faceConfidenceThreshold);
        setCameraMode(params.cameraMode);
        setFrameProcessorFPS(params.frameProcessorFPS);
      } catch (e) {
        console.error('解析缓存参数失败:', e);
      }
    }
  }, []);

  useEffect(() => {
    loadInitialRecognitionParams();
  }, [loadInitialRecognitionParams]);

  useEffect(() => {
    const paramsToSave: RecognitionParams = {
      isFront,
      isLiveness,
      faceScore,
      faceQuality,
      facePreviewSize,
      faceConfidenceThreshold,
      cameraMode,
      frameProcessorFPS,
    };
    recognitionStorage.set(RECOGNITION_PARAMS_KEY, JSON.stringify(paramsToSave));
  }, [
    isFront,
    isLiveness,
    faceScore,
    faceQuality,
    facePreviewSize,
    faceConfidenceThreshold,
    cameraMode,
    frameProcessorFPS,
  ]);

  const showToast = useCallback((message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert(message);
    }
  }, []);

  const loadInitImg = async () => {
    if (!selectedCampus) {
      showToast('请先选择一个校区');
      return;
    }
    if (!sessionRef.current) {
      showToast('人脸识别会话未初始化');
      return;
    }

    // 创建 FaceRegistrationService 实例
    const faceRegistrationService = new FaceRegistrationService(sessionRef.current);

    // 显示进度模态框
    setIsBeginFace(false); // 开始加载时禁用"开始刷脸"按钮
    setProgressVisible(true);
    setProgressLog([]);
    setProgressComplete(false);
    setIsSuccess(false);
    setProgressFailed(0);
    setElapsedTime('');

    // 只有在开始新的处理任务时才重置进度计数
    setProgressCurrent(0);
    setProgressTotal(0);

    try {
      // 调用 FaceRegistrationService 的 reloadCampusPhotos 方法
      await faceRegistrationService.reloadCampusPhotos(
        selectedCampus,
        async (detail: string, type: LogEntry['type'] = 'log') => {
          // 更新进度日志
          console.log(`[进度] ${detail}`);
          setProgressLog(prevLog => [...prevLog, { text: detail, type }]);

          // 如果是错误类型，增加失败计数
          if (type === 'error') {
            setProgressFailed(prev => prev + 1);
          }

          // 让出执行权给 UI 线程
          await yieldToMain();
        },
        (progress) => {
          // 更新进度状态
          setProgressTotal(progress.total);
          setProgressCurrent(progress.current);
          setProgressFailed(progress.failed);

          // 如果完成了，设置耗时
          if (progress.isComplete) {
            setElapsedTime(progress.elapsedTime);
            setIsSuccess(progress.isSuccess);
          }
        }
      );

      setIsSuccess(true);
    } catch (error) {
      const errMsg = (error as Error).message;
      console.error('重新载入照片失败:', errMsg);
      setIsSuccess(false);
    } finally {
      setIsBeginFace(true); // 加载完成后启用"开始刷脸"按钮
      setProgressComplete(true);
      // 不再重置 progressCurrent 和 progressTotal，保持最后的统计值
    }
  };

  useEffect(() => {
    let message = `共 ${progressTotal} 张，已处理 ${progressCurrent} 张`;
    if (progressFailed > 0) {
      message += `, 失败 ${progressFailed} 张`;
    }
    setProgressMessage(message);
  }, [progressCurrent, progressTotal, progressFailed]);

  useEffect(() => {
    if (isProgressVisible) {
      // 使用setTimeout确保在UI渲染完成后再滚动
      setTimeout(() => {
        progressScrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [progressLog, isProgressVisible]);

  const fetchCampusList = async () => {
    try {
      const currentUser = getCurrentUser();
      if (!currentUser) return;
      const res = await apiFind('szproctec', {
        procedure: 'st_con_campus_select',
        i_idopr: currentUser.ID,
        i_vcpym: '',
        i_isenable: 1,
      });
      const dataKey = '#result-set-1';
      if (res && res.data && res.data[dataKey]) {
        const campuses: Campus[] = res.data[dataKey];
        setCampusList(campuses);
        const defaultCampus =
          campuses.find((c) => c.ID === currentUser.IDCAMPUS) || campuses[0];
        if (defaultCampus) {
          setSelectedCampus(defaultCampus);
          // ✅ 关键修改点：将 defaultCampus 的 ID 和 NAME 保存到 currentUser
          // 确保只有当 currentUser 的 campusId 和 campusName 发生变化时才更新
          if (currentUser.campusId !== defaultCampus.ID ) {
              const updatedUser: User = {
                  ...currentUser,
                  campusId: defaultCampus.ID,
                  campusName: defaultCampus.VCNAME,
              };
              setCurrentUser(updatedUser); // 更新到本地存储
              // 如果你的 currentUser 状态也在 SettingFace 组件中管理，你可能还需要更新该组件的状态
              // 例如：setGlobalCurrentUser(updatedUser);
              console.log('CurrentUser updated with default campus:', updatedUser);
          }
        }
      }
    } catch (error) {
      console.error('获取校区列表失败:', error);
      showToast('获取校区列表失败');
    }
  };

  useEffect(() => {
    sessionRef.current = InspireFace.createSession(
      { enableRecognition: true },
      DetectMode.ALWAYS_DETECT,
      1, -1, -1
    );
    fetchCampusList();
    findInfo();
    return () => {
      sessionRef.current?.dispose();
    };
  }, []);

  const findInfo = async () => {
    try {
      const currentUser = getCurrentUser();
      if (!currentUser) return;

      const res = await apiFind('szproctec', {
        procedure: 'st_pfm_config_face_se_init',
        i_idopr: currentUser.ID,
      });
      if (res?.data) {
        const resultSet1 = res.data['#result-set-1'];
        const resultSet2 = res.data['#result-set-2'];
        if (resultSet2) setOutDataInfo({ data2: resultSet2 });

        // 如果 MMKV 中没有缓存参数，则从 API 获取并设置状态，同时保存到 MMKV
        const hasCachedParams = recognitionStorage.contains(RECOGNITION_PARAMS_KEY);
        if (!hasCachedParams && resultSet1 && resultSet1.length > 0) {
          const config = resultSet1[0];
          const apiParams: RecognitionParams = {
            faceScore: Number(config.QIFACESCORE) || 70,
            faceQuality: Number(config.QIFACEWHILE) || 70,
            isFront: config.VCFACENET === '1',
            isLiveness: config.ISFACELAST === '1',
            facePreviewSize: config.QIFACESIZE || '',
            faceConfidenceThreshold: 70,
            cameraMode: 'contain',
            frameProcessorFPS: 30,
          };
          // 更新状态，这将触发上面的 useEffect 自动保存到 MMKV
          setFaceScore(apiParams.faceScore);
          setFaceQuality(apiParams.faceQuality);
          setIsFront(apiParams.isFront);
          setIsLiveness(apiParams.isLiveness);
          setFacePreviewSize(apiParams.facePreviewSize);
          setFaceConfidenceThreshold(apiParams.faceConfidenceThreshold);
          setCameraMode(apiParams.cameraMode);
          setFrameProcessorFPS(apiParams.frameProcessorFPS);
        }

        setIdtype(Number(res.data.ITYPE));
        setTypetext(res.data.VCTYPE);
      }
    } catch (error) {
      Alert.alert('错误', '获取配置信息失败');
    }
  };

  const handleSelectCampus = (campus: Campus) => {
    setSelectedCampus(campus);
    setCampusModalVisible(false);
  };

  const handleCopyLog = () => {
    const logString = progressLog.map(log => `[${log.type.toUpperCase()}] ${log.text}`).join('\n');
    Clipboard.setString(logString);
    showToast('日志已复制到剪贴板');
  };

  // 处理"开始刷脸"按钮点击事件
  const handleStartFaceRecognition = () => {
    // 导航时传递当前状态中的参数
    navigation.navigate('FaceShow', { // 修改为 FaceShow
      isFront,
      isLiveness,
      faceScore,
      faceQuality,
      facePreviewSize,
      faceConfidenceThreshold,
      cameraMode,
      frameProcessorFPS,
    });
  };

  // 模拟让出执行权给 UI 线程的函数
  const yieldToMain = () => {
    return new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView style={styles.container}>
        <TouchableOpacity
          style={styles.campusSelector}
          onPress={() => setCampusModalVisible(true)}
        >
          <Text style={styles.campusSelectorText}>
            当前校区: {selectedCampus ? selectedCampus.VCNAME : '请选择'}
          </Text>
          <Text>▼</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text>{typetext}</Text>
          </View>
        </View>

        {idtype === 4 &&
          outDataInfo.data2.map((item, index) => (
            <View style={styles.card} key={index}>
              <View style={styles.cardTop}>
                <Text>{item.VCNAME}</Text>
              </View>
              <View style={styles.cardBottom}>
                {item.ISQD === '1' && (
                  <Text>
                    签到时间段: {item.DTQDS} - {item.DTQDE}
                  </Text>
                )}
                {item.ISQT === '1' && (
                  <Text>
                    签退时间段: {item.DTQTS} - {item.DTQTE}
                  </Text>
                )}
              </View>
            </View>
          ))}

        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text>识别参数</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>摄像头:</Text>
            <View style={styles.switchContainer}>
              <Text>后置</Text>
              <Switch value={isFront} onValueChange={setIsFront} />
              <Text>前置</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>活体检测:</Text>
            <View style={styles.switchContainer}>
              <Text>关闭</Text>
              <Switch value={isLiveness} onValueChange={setIsLiveness} />
              <Text>开启</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>相似度:</Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={100}
              step={1}
              value={faceScore}
              onSlidingComplete={setFaceScore}
            />
            <Text style={styles.sliderValue}>{faceScore}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>拍照质量:</Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={100}
              step={1}
              value={faceQuality}
onSlidingComplete={setFaceQuality}
            />
            <Text style={styles.sliderValue}>{faceQuality}</Text>
          </View>

          <View style={styles.row}>
<Text style={styles.label}>置信度阈值:</Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={100}
              step={1}
              value={faceConfidenceThreshold}
              onSlidingComplete={setFaceConfidenceThreshold}
            />
            <Text style={styles.sliderValue}>{faceConfidenceThreshold}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>相机模式:</Text>
            <View style={styles.switchContainer}>
              <Switch
                value={cameraMode === 'cover'}
                onValueChange={(value) => setCameraMode(value ? 'cover' : 'contain')}
              />
              <Text>{cameraMode === 'cover' ? 'Cover' : 'Contain'}</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>帧率:</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={frameProcessorFPS}
              onSlidingComplete={setFrameProcessorFPS}
            />
            <Text style={styles.sliderValue}>{frameProcessorFPS} FPS</Text>
          </View>

          <View style={styles.buttonContainer}>
            <Button title="重新载入照片" onPress={loadInitImg} />
            <View style={{ width: 20 }} />
            <Button
              title="查看已注册照片"
              onPress={() => navigation.navigate('RegisteredFaces')}
            />
          </View>
        </View>
      </ScrollView>
      <View style={styles.bottomBar}>
        {idtype !== 3 && (
          <TouchableOpacity
            style={styles.bottomButton}
            onPress={() => navigation.navigate('SkiaDemo')}
          >
            <Text style={styles.buttonText}>刷脸记录</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.bottomButton,
            { backgroundColor: isBeginFace ? '#2fd9b1' : '#999999' },
          ]}
          onPress={handleStartFaceRecognition} // 添加点击事件
        >
          <Text style={styles.buttonText}>开始刷脸</Text>
        </TouchableOpacity>
      </View>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isProgressVisible}
        onRequestClose={() => {}}
      >
        <View style={styles.progressModalContainer}>
          <View style={styles.progressModalContent}>
            {isProgressComplete ? (
              <Text style={isSuccess ? styles.successIcon : styles.errorIcon}>
                {isSuccess ? '✓' : '✗'}
              </Text>
            ) : (
              <ActivityIndicator size="large" color="#2fd9b1" />
            )}
            <Text style={styles.progressText}>{progressMessage}</Text>
            {isProgressComplete && <Text style={styles.elapsedTimeText}>{elapsedTime}</Text>}
            <ScrollView
              ref={progressScrollViewRef}
              style={styles.progressLogContainer}
              nestedScrollEnabled={true}
              showsVerticalScrollIndicator={true} // 显示滚动条
              onContentSizeChange={() => progressScrollViewRef.current?.scrollToEnd({ animated: true })} // 内容变化时滚动到底部
            >
              {progressLog.map((log, index) => (
                <Text
                  key={index}
                  style={[
                    styles.progressDetailText,
                    log.type === 'error' && styles.progressErrorText,
                    log.type === 'success' && styles.progressSuccessText,
                  ]}
                >
                  {log.text}
                </Text>
              ))}
            </ScrollView>
            {isProgressComplete && (
              <View style={styles.progressButtonContainer}>
                <Button title="一键复制" onPress={handleCopyLog} />
                <View style={{ width: 20 }} />
                <Button title="关闭" onPress={() => setProgressVisible(false)} />
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={isCampusModalVisible}
        onRequestClose={() => setCampusModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <FlatList
              data={campusList}
              keyExtractor={(item) => item.ID.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalItem}
                  onPress={() => handleSelectCampus(item)}
                >
                  <Text style={styles.modalItemText}>{item.VCNAME}</Text>
                </TouchableOpacity>
              )}
            />
            <Button title="关闭" onPress={() => setCampusModalVisible(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 15,
    marginBottom: 100,
  },
  campusSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 20,
  },
  campusSelectorText: {
    fontSize: 16,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#dcdcdc',
    borderRadius: 5,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  cardTop: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#dcdcdc',
  },
  cardBottom: {
    padding: 15,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  label: {
    width: 80,
    textAlign: 'right',
    marginRight: 10,
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 8,
    borderRadius: 4,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  sliderValue: {
    width: 40,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 15,
    backgroundColor: '#EEFCF9',
    borderTopWidth: 1,
    borderColor: '#ddd',
  },
  bottomButton: {
    flex: 1,
    marginHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2868e2',
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    width: '80%',
    maxHeight: '60%',
  },
  modalItem: {
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalItemText: {
    fontSize: 16,
    textAlign: 'center',
  },
  // Progress modal styles
  progressModalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  progressModalContent: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    width: '90%',
    maxWidth: 500,
    alignItems: 'center',
    elevation: 5,
  },
  progressText: {
    marginTop: 15,
    fontSize: 16,
    fontWeight: 'bold',
  },
  elapsedTimeText: {
    marginTop: 5,
    fontSize: 14,
    color: '#333',
  },
  progressLogContainer: {
    marginTop: 10,
    height: 200, // 固定高度
    width: '100%',
    borderColor: '#eee',
    borderWidth: 1,
    borderRadius: 5,
    padding: 10,
    backgroundColor: '#f9f9f9',
  },
  progressDetailText: {
    fontSize: 12,
    color: '#333',
    lineHeight: 18, // 增加行高以改善可读性
  },
  progressErrorText: {
    color: 'red',
  },
  progressSuccessText: {
    color: 'green',
    fontWeight: 'bold',
  },
  progressButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    marginTop: 20,
  },
  successIcon: {
    fontSize: 40,
    color: 'green',
  },
  errorIcon: {
    fontSize: 40,
    color: 'red',
  },
});

export default SettingFace;
