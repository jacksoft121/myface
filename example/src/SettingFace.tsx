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
import RNFS from 'react-native-fs';
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
import { getCurrentUser } from './comm/User';
import { recognitionStorage } from './comm/GlobalStorage';
import {
  insertName,
  queryUsersByOrgId,
  deleteUsersByOrgId,
  updateDlxUserByFaceId,
} from './comm/FaceDB';

// #region Type Definitions
type RootStackParamList = {
  Login: undefined;
  ArcSoftInfo: undefined;
  RegisteredFaces: undefined;
  FaceShow: {
    isFront: boolean;
    isLiveness: boolean;
    faceScore: number;
    faceQuality: number;
    facePreviewSize: string;
  };
  SkiaDemo: undefined;
};

type ArcSoftInfoScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'ArcSoftInfo'
>;

type LogEntry = {
  text: string;
  type: 'log' | 'error' | 'success';
};

type Campus = {
  ID: number;
  VCNAME: string;
  // ... 其他 Campus 属性
};

type RecognitionParams = {
  isFront: boolean;
  isLiveness: boolean;
  faceScore: number;
  faceQuality: number;
  facePreviewSize: string;
};
// #endregion

const RECOGNITION_PARAMS_KEY = 'recognition_params';

// Helper to force UI update
const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

const SettingFace = () => {
  const navigation = useNavigation<ArcSoftInfoScreenNavigationProp>();
  const [typetext, setTypetext] = useState('');
  const [outDataInfo, setOutDataInfo] = useState({ data2: [] });

  // 校区选择相关状态
  const [campusList, setCampusList] = useState<Campus[]>([]);
  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null);
  const [isCampusModalVisible, setCampusModalVisible] = useState(false);

  // 进度条相关状态
  const [isProgressVisible, setProgressVisible] = useState(false);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressFailed, setProgressFailed] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressLog, setProgressLog] = useState<LogEntry[]>([]);
  const [isProgressComplete, setProgressComplete] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(''); // 新增：用于存储总耗时
  const progressScrollViewRef = useRef<ScrollView>(null);

  // 加载初始识别参数
  const loadInitialRecognitionParams = useCallback((): RecognitionParams => {
    const storedParams = recognitionStorage.getString(RECOGNITION_PARAMS_KEY);
    if (storedParams) {
      try {
        const parsedParams = JSON.parse(storedParams);
        return {
          isFront: parsedParams.isFront ?? true,
          isLiveness: parsedParams.isLiveness ?? true,
          faceScore: parsedParams.faceScore ?? 70,
          faceQuality: parsedParams.faceQuality ?? 70,
          facePreviewSize: parsedParams.facePreviewSize ?? '',
        };
      } catch (e) {
        console.error('Failed to parse recognition params from MMKV', e);
      }
    }
    // 默认值
    return {
      isFront: true,
      isLiveness: true,
      faceScore: 70,
      faceQuality: 70,
      facePreviewSize: '',
    };
  }, []);

  const initialRecognitionParams = loadInitialRecognitionParams();

  const [isFront, setIsFront] = useState<boolean>(initialRecognitionParams.isFront);
  const [isLiveness, setIsLiveness] = useState<boolean>(initialRecognitionParams.isLiveness);
  const [faceScore, setFaceScore] = useState<number>(initialRecognitionParams.faceScore);
  const [faceQuality, setFaceQuality] = useState<number>(initialRecognitionParams.faceQuality);
  const [facePreviewSize, setFacePreviewSize] = useState<string>(initialRecognitionParams.facePreviewSize);

  const [msg, setMsg] = useState('1');
  const [isBeginFace, setIsBeginFace] = useState(false); // 控制“开始刷脸”按钮是否可用
  const [idtype, setIdtype] = useState(0);

  const sessionRef = useRef<InspireFaceSession | null>(null);

  // 当识别参数变化时，保存到 MMKV
  useEffect(() => {
    const paramsToSave: RecognitionParams = {
      isFront,
      isLiveness,
      faceScore,
      faceQuality,
      facePreviewSize,
    };
    recognitionStorage.set(RECOGNITION_PARAMS_KEY, JSON.stringify(paramsToSave));
  }, [isFront, isLiveness, faceScore, faceQuality, facePreviewSize]);


  const extractFeatureFromUrlSession = async (
    imageUrl: string,
    session: InspireFaceSession,
    onProgress: (detail: string, type?: LogEntry['type']) => Promise<void>
  ): Promise<ArrayBuffer | null> => {
    if (!imageUrl || !session) {
      return null;
    }
    const tempFilePath = `${
      RNFS.CachesDirectoryPath
    }/${new Date().getTime()}.jpg`;
    let bitmap = null;
    let imageStream = null;
    try {
      await onProgress('正在下载图片...');
      const download = await RNFS.downloadFile({
        fromUrl: imageUrl,
        toFile: tempFilePath,
      }).promise;
      if (download.statusCode !== 200) {
        await onProgress('图片下载失败', 'error');
        return null;
      }

      await onProgress('正在创建图像流...');
      bitmap = InspireFace.createImageBitmapFromFilePath(3, tempFilePath);
      imageStream = InspireFace.createImageStreamFromBitmap(
        bitmap,
        CameraRotation.ROTATION_0
      );
      imageStream.setFormat(ImageFormat.BGR);

      await onProgress('正在检测人脸...');
      const faceInfos = session.executeFaceTrack(imageStream);
      if (faceInfos.length > 0 && faceInfos[0]) {
        await onProgress('正在提取特征...');
        return session.extractFaceFeature(imageStream, faceInfos[0].token);
      }
      await onProgress('未检测到人脸', 'error');
      return null;
    } catch (error) {
      const errMsg = (error as Error).message;
      await onProgress(`处理图片时出错: ${errMsg}`, 'error');
      console.error(`处理图片时出错 ${imageUrl}:`, error);
      return null;
    } finally {
      imageStream?.dispose();
      bitmap?.dispose();
      RNFS.unlink(tempFilePath).catch(() => {});
    }
  };

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

    setIsBeginFace(false); // 开始加载时禁用“开始刷脸”按钮
    setProgressVisible(true);
    setProgressLog([]);
    setProgressComplete(false);
    setIsSuccess(false);
    setProgressFailed(0);
    setElapsedTime('');

    const startTime = performance.now();
    let wasSuccessful = true;

    const updateProgress = async (detail: string, type: LogEntry['type'] = 'log') => {
      if (type === 'error') {
        wasSuccessful = false;
        setProgressFailed(prev => prev + 1);
      }
      console.log(`[进度] ${detail}`);
      setProgressLog(prevLog => [...prevLog, { text: detail, type }]);
      await yieldToMain();
    };

    await updateProgress('正在计算需要处理的照片数量...');

    try {
      // 1. 预计算总数
      const studentRes = await apiFind('szproctec', {
        procedure: 'st_con_student_se_imgpath',
        i_idcampus: selectedCampus.ID,
        i_dtver: 0,
      });
      const teacherRes = await apiFind('szproctec', {
        procedure: 'st_con_teacher_se_imgpath',
        i_idcampus: selectedCampus.ID,
        i_dtver: 0,
      });

      const studentsToRegister = studentRes.data?.['#result-set-3'] || [];
      const teachersToRegister = teacherRes.data?.['#result-set-3'] || [];
      const total = studentsToRegister.length + teachersToRegister.length;

      setProgressTotal(total);
      setProgressCurrent(0);

      if (total === 0) {
        await updateProgress('没有需要载入的照片。');
        return;
      }

      // 2. 清空当前校区的旧数据
      await updateProgress(`正在清空校区 "${selectedCampus.VCNAME}" 的旧数据...`);
      const usersToDelete = await queryUsersByOrgId(String(selectedCampus.ID));
      for (const user of usersToDelete) {
        await InspireFace.featureHubFaceRemove(user.id);
      }
      await deleteUsersByOrgId(String(selectedCampus.ID));
      await updateProgress(`已删除 ${usersToDelete.length} 条旧记录。`);


      let currentCount = 0;

      // 3. 注册学生
      for (const student of studentsToRegister) {
        currentCount++;
        setProgressCurrent(currentCount);
        const userName = `${student.VCNAME}`;
        await updateProgress(`处理中 (学生): ${userName}`);

        const feature = await extractFeatureFromUrlSession(
          student.VCIMGPATH,
          sessionRef.current,
          updateProgress
        );

        if (feature) {
          await updateProgress(`正在为 ${userName} 注册到人脸库...`);
          const faceId = await InspireFace.featureHubFaceInsert({
            id: -1,
            feature,
          });
          if (typeof faceId === 'number' && faceId !== -1) {
            await updateProgress(`注册成功，Face ID: ${faceId}，正在写入数据库...`, 'success');
            await insertName(
              faceId,
              String(student.ID),
              student.VCNAME,
              "2", // role: student
              String(selectedCampus.ID),
              selectedCampus.VCNAME,
              student.VCIMGPATH
            );

          } else {
            await updateProgress(`${userName} 的人脸库插入失败`, 'error');
          }
        }
      }

      // 4. 注册教师
      for (const teacher of teachersToRegister) {
        currentCount++;
        setProgressCurrent(currentCount);
        const userName = `${teacher.VCNAME}`;
        await updateProgress(`处理中 (老师): ${userName}`);

        const feature = await extractFeatureFromUrlSession(
          teacher.VCIMGPATH,
          sessionRef.current,
          updateProgress
        );
        if (feature) {
          await updateProgress(`正在为 ${userName} 注册到人脸库...`);
          const faceId = await InspireFace.featureHubFaceInsert({
            id: -1,
            feature,
          });
          if (typeof faceId === 'number' && faceId !== -1) {
            await updateProgress(`注册成功，Face ID: ${faceId}，正在写入数据库...`, 'success');
            await insertName(
              faceId,
              teacher.VCNAME,
              String(teacher.ID),
              teacher.VCNAME,
              "1", // role: teacher
              String(selectedCampus.ID),
              selectedCampus.VCNAME,
              teacher.VCIMGPATH);

          } else {
            await updateProgress(`${userName} 的人脸库插入失败`, 'error');
          }
        }
      }

      await updateProgress('全部处理完成！', 'success');
    } catch (error) {
      const errMsg = (error as Error).message;
      await updateProgress(`发生严重错误: ${errMsg}`, 'error');
      console.error('重新载入照片失败:', errMsg);
    } finally {
      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;
      setElapsedTime(`耗时: ${duration.toFixed(2)} 秒`);
      setIsBeginFace(true); // 加载完成后启用“开始刷脸”按钮
      setProgressComplete(true);
      setIsSuccess(wasSuccessful);
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
      progressScrollViewRef.current?.scrollToEnd({ animated: true });
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
        const defaultCampus =
          campuses.find((c) => c.ID === currentUser.ID) || campuses[0];
        if (defaultCampus) {
          setSelectedCampus(defaultCampus);
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
          };
          // 更新状态，这将触发上面的 useEffect 自动保存到 MMKV
          setFaceScore(apiParams.faceScore);
          setFaceQuality(apiParams.faceQuality);
          setIsFront(apiParams.isFront);
          setIsLiveness(apiParams.isLiveness);
          setFacePreviewSize(apiParams.facePreviewSize);
        }
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

  // 处理“开始刷脸”按钮点击事件
  const handleStartFaceRecognition = () => {
    // 导航时传递当前状态中的参数
    navigation.navigate('FaceShow', { // 修改为 FaceShow
      isFront,
      isLiveness,
      faceScore,
      faceQuality,
      facePreviewSize,
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
            <Text style={styles.label}>分辨率:</Text>
            <TextInput
              style={styles.input}
              value={facePreviewSize}
              onChangeText={setFacePreviewSize}
              placeholder="例如 640x480"
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>设备状态:</Text>
            <Text>{msg === '1' ? '已激活' : '未激活'}</Text>
            {msg !== '1' && <Button title="前往激活" onPress={() => {}} />}
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
    fontSize: 18,
    textAlign: 'center',
  },
  // Progress Modal styles
  progressModalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
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
  },
  progressErrorText: {
    color: 'red',
    fontWeight: 'bold',
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
