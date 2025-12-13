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
} from 'react-native';
import { MMKV } from 'react-native-mmkv';
import Slider from '@react-native-community/slider';
import RNFS from 'react-native-fs';
import { apiFind } from './api';
import {
  InspireFace,
  DetectMode,
  type InspireFaceSession,
  CameraRotation,
  ImageFormat,
  SearchMode,
  PrimaryKeyMode,
} from 'react-native-nitro-inspire-face';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getCurrentUser } from './User';

// #region Type Definitions
type RootStackParamList = {
  Login: undefined;
  ArcSoftInfo: undefined;
  RegisteredFaces: undefined;
};

type ArcSoftInfoScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'ArcSoftInfo'
>;

interface Campus {
  ID: number;
  VCNAME: string;
}
// #endregion

// #region MMKV and InspireFace Initialization
const recognitionStorage = new MMKV({
  id: 'recognition-params-storage',
});
const faceVersionStorage = new MMKV({
  id: 'face-version-storage',
});
const faceIdMappingStorage = new MMKV({
  id: 'face-id-mapping-storage',
});
const userInfoCacheStorage = new MMKV({
  id: 'user-info-cache-storage',
});

try {
  InspireFace.launch('Pikachu');
  InspireFace.featureHubDataEnable({
    enablePersistence: true,
    persistenceDbPath: 'inspireface.db',
    searchThreshold: 0.42,
    searchMode: SearchMode.EXHAUSTIVE,
    primaryKeyMode: PrimaryKeyMode.AUTO_INCREMENT,
  });
} catch (e) {
  Alert.alert('引擎启动失败', (e as Error).message);
}
// #endregion

const RECOGNITION_PARAMS_KEY = 'recognition_params';
const FACE_DTVER_KEY_PREFIX = 'FACE_DTVER_';
const FACE_DTVER_T_KEY_PREFIX = 'FACE_DTVER_T_';

const ArcSoftInfoScreen = () => {
  const navigation = useNavigation<ArcSoftInfoScreenNavigationProp>();
  const [typetext, setTypetext] = useState('');
  const [outDataInfo, setOutDataInfo] = useState({ data2: [] });

  // 校区选择相关状态
  const [campusList, setCampusList] = useState<Campus[]>([]);
  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null);
  const [isCampusModalVisible, setCampusModalVisible] = useState(false);

  const [isFront, setIsFront] = useState(true);
  const [isLiveness, setIsLiveness] = useState(true);
  const [faceScore, setFaceScore] = useState(70);
  const [faceQuality, setFaceQuality] = useState(70);
  const [facePreviewSize, setFacePreviewSize] = useState('');

  const [msg, setMsg] = useState('1');
  const [isBeginFace, setIsBeginFace] = useState(false);
  const [idtype, setIdtype] = useState(0);
  const [paramsInitialized, setParamsInitialized] = useState(false);

  const sessionRef = useRef<InspireFaceSession | null>(null);

  const extractFeatureFromUrlSession = async (
    imageUrl: string,
    session: InspireFaceSession
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
      const download = await RNFS.downloadFile({
        fromUrl: imageUrl,
        toFile: tempFilePath,
      }).promise;
      if (download.statusCode !== 200) {
        console.error(`下载图片失败: ${imageUrl}, 状态码: ${download.statusCode}`);
        return null;
      }
      bitmap = InspireFace.createImageBitmapFromFilePath(3, tempFilePath);
      imageStream = InspireFace.createImageStreamFromBitmap(
        bitmap,
        CameraRotation.ROTATION_0
      );
      imageStream.setFormat(ImageFormat.BGR);
      const faceInfos = session.executeFaceTrack(imageStream);
      if (faceInfos.length > 0 && faceInfos[0]) {
        return session.extractFaceFeature(imageStream, faceInfos[0].token);
      }
      console.log(`在图片中未检测到人脸: ${imageUrl}`);
      return null;
    } catch (error) {
      console.error(`处理图片时出错 ${imageUrl}:`, error);
      return null;
    } finally {
      imageStream?.dispose();
      bitmap?.dispose();
      RNFS.unlink(tempFilePath).catch((err) =>
        console.error('删除临时文件失败', err)
      );
    }
  };

  const showToast = useCallback((message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert(message);
    }
  }, []);

  const findStudentImg = useCallback(
    async (currentVer: number, localUserNames: string[]) => {
      if (!sessionRef.current || !selectedCampus) {
        showToast('人脸识别会话或校区未初始化');
        return;
      }
      try {
        const res = await apiFind('szproctec', {
          procedure: 'st_con_student_se_imgpath',
          i_idcampus: selectedCampus.ID,
          i_dtver: currentVer,
        });

        const toDelete = res.data?.['#result-set-1'] || [];
        const newVersionStr = res.data?.['#result-set-2']?.[0]?.DTVER;
        const toRegister = res.data?.['#result-set-3'] || [];

        if (currentVer === 0) {
          const studentUserNames = localUserNames.filter(
            (name) => !name.includes('_T_')
          );
          for (const name of studentUserNames) {
            const hubId = faceIdMappingStorage.getNumber(name);
            if (hubId) {
              await InspireFace.featureHubFaceRemove(hubId);
              faceIdMappingStorage.delete(name);
              userInfoCacheStorage.delete(name);
            }
          }
        } else {
          for (const student of toDelete) {
            const userName = `${student.ID}_${student.VCNAME}`;
            const hubId = faceIdMappingStorage.getNumber(userName);
            if (hubId) {
              await InspireFace.featureHubFaceRemove(hubId);
              faceIdMappingStorage.delete(userName);
              userInfoCacheStorage.delete(userName);
            }
          }
        }

        for (const student of toRegister) {
          const userName = `${student.ID}_${student.VCNAME}`;
          const feature = await extractFeatureFromUrlSession(
            student.VCIMGPATH,
            sessionRef.current
          );
          if (feature) {
            const result = await InspireFace.featureHubFaceInsert({
              id: -1,
              feature,
            });
            if (result && typeof result.id === 'number' && result.id !== -1) {
              faceIdMappingStorage.set(userName, result.id);
              userInfoCacheStorage.set(
                userName,
                JSON.stringify({
                  name: student.VCNAME,
                  imageUrl: student.VCIMGPATH,
                })
              );
            } else {
              showToast(`${userName} 注册失败`);
            }
          } else {
            showToast(`无法从照片中提取 ${userName} 的人脸`);
          }
        }

        if (newVersionStr) {
          const newVersionNum = Number(newVersionStr);
          faceVersionStorage.set(
            `${FACE_DTVER_KEY_PREFIX}${selectedCampus.ID}`,
            newVersionNum
          );
        }
      } catch (error) {
        const errMsg = (error as Error).message;
        console.error('同步学生人脸失败:', errMsg);
        showToast(`同步学生人脸失败: ${errMsg}`);
      }
    },
    [showToast, selectedCampus]
  );

  const findTeacherImg = useCallback(
    async (currentVer: number, localUserNames: string[]) => {
      if (!sessionRef.current || !selectedCampus) {
        showToast('人脸识别会话或校区未初始化');
        return;
      }
      try {
        const res = await apiFind('szproctec', {
          procedure: 'st_con_teacher_se_imgpath',
          i_idcampus: selectedCampus.ID,
          i_dtver: currentVer,
        });

        const toDelete = res.data?.['#result-set-1'] || [];
        const newVersionStr = res.data?.['#result-set-2']?.[0]?.DTVER;
        const toRegister = res.data?.['#result-set-3'] || [];

        if (currentVer === 0) {
          const teacherUserNames = localUserNames.filter((name) =>
            name.includes('_T_')
          );
          for (const name of teacherUserNames) {
            const hubId = faceIdMappingStorage.getNumber(name);
            if (hubId) {
              await InspireFace.featureHubFaceRemove(hubId);
              faceIdMappingStorage.delete(name);
              userInfoCacheStorage.delete(name);
            }
          }
        } else {
          for (const teacher of toDelete) {
            const teacherName = localUserNames.find((name) =>
              name.startsWith(`${teacher.ID}_T_`)
            );
            if (teacherName) {
              const hubId = faceIdMappingStorage.getNumber(teacherName);
              if (hubId) {
                await InspireFace.featureHubFaceRemove(hubId);
                faceIdMappingStorage.delete(teacherName);
                userInfoCacheStorage.delete(teacherName);
              }
            }
          }
        }

        for (const teacher of toRegister) {
          const userName = `${teacher.ID}_T_${teacher.VCNAME}`;
          const feature = await extractFeatureFromUrlSession(
            teacher.VCIMGPATH,
            sessionRef.current
          );
          if (feature) {
            const result = await InspireFace.featureHubFaceInsert({
              id: -1,
              feature,
            });
            if (result && typeof result.id === 'number' && result.id !== -1) {
              faceIdMappingStorage.set(userName, result.id);
              userInfoCacheStorage.set(
                userName,
                JSON.stringify({
                  name: teacher.VCNAME,
                  imageUrl: teacher.VCIMGPATH,
                })
              );
            } else {
              showToast(`${userName} 注册失败`);
            }
          } else {
            showToast(`无法从照片中提取 ${userName} 的人脸`);
          }
        }

        if (newVersionStr) {
          const newVersionNum = Number(newVersionStr);
          faceVersionStorage.set(
            `${FACE_DTVER_T_KEY_PREFIX}${selectedCampus.ID}`,
            newVersionNum
          );
        }
      } catch (error) {
        const errMsg = (error as Error).message;
        console.error('同步教师人脸失败:', errMsg);
        showToast(`同步教师人脸失败: ${errMsg}`);
      }
    },
    [showToast, selectedCampus]
  );

  const initfaceImg = useCallback(
    async (currentVer: number, currentVerT: number) => {
      if (!selectedCampus) return;
      console.log(`开始为校区 ${selectedCampus.VCNAME} 初始化人脸库...`);
      setIsBeginFace(false);

      try {
        const localUserNames = faceIdMappingStorage.getAllKeys();
        console.log(`从映射中加载了 ${localUserNames.length} 个用户名`);

        await findStudentImg(currentVer, localUserNames);
        await findTeacherImg(currentVerT, localUserNames);

        const finalUserNames = faceIdMappingStorage.getAllKeys();
        console.log(`同步完成，最终人脸数量: ${finalUserNames.length}`);

        setIsBeginFace(true);
        showToast('人脸库已更新');
      } catch (error) {
        const errMsg = (error as Error).message;
        console.error('初始化人脸库时发生严重错误:', errMsg);
        showToast(`初始化人脸库失败: ${errMsg}`);
      }
    },
    [findStudentImg, findTeacherImg, showToast, selectedCampus]
  );

  const loadInitImg = async () => {
    if (!selectedCampus) {
      showToast('请先选择一个校区');
      return;
    }
    console.log('手动触发“重新载入照片”...');
    showToast('正在重新加载所有人脸数据...');
    await initfaceImg(0, 0);
  };

  const fetchCampusList = async () => {
    try {
      const currentUser = getCurrentUser();
      if (!currentUser) return;
      const res = await apiFind('szproctec', {
        procedure: 'st_con_campus_select', // 更新接口名称
        i_idopr: currentUser.ID,
        i_vcpym: '', // 添加参数
        i_isenable: 1, // 添加参数
      });
      // 假设返回的数据在 res.data['#result-set-1']
      const dataKey = '#result-set-1';
      if (res && res.data && res.data[dataKey]) {
        const campuses: Campus[] = res.data[dataKey];
        setCampusList(campuses);
        // 设置默认校区
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

  // 组件首次加载时获取校区列表
  useEffect(() => {
    sessionRef.current = InspireFace.createSession(
      { enableRecognition: true },
      DetectMode.ALWAYS_DETECT,
      1, -1, -1
    );
    console.log('InspireFace 会话已创建。');

    fetchCampusList();

    return () => {
      console.log('清理 InspireFace 会话。');
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, []);

  // 当校区变化时，触发人脸数据加载
  useEffect(() => {
    if (selectedCampus) {
      console.log(`校区已切换至: ${selectedCampus.VCNAME}`);
      const studentVer =
        faceVersionStorage.getNumber(
          `${FACE_DTVER_KEY_PREFIX}${selectedCampus.ID}`
        ) || 0;
      const teacherVer =
        faceVersionStorage.getNumber(
          `${FACE_DTVER_T_KEY_PREFIX}${selectedCampus.ID}`
        ) || 0;
      initfaceImg(studentVer, teacherVer);
    }
  }, [selectedCampus, initfaceImg]);

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

        const hasCachedParams =
          recognitionStorage.contains(RECOGNITION_PARAMS_KEY);
        if (!hasCachedParams && resultSet1 && resultSet1.length > 0) {
          const config = resultSet1[0];
          const apiParams = {
            faceScore: Number(config.QIFACESCORE) || 70,
            faceQuality: Number(config.QIFACEWHILE) || 70,
            isFront: config.VCFACENET === '1',
            isLiveness: config.ISFACELAST === '1',
            facePreviewSize: config.QIFACESIZE || '',
          };
          setFaceScore(apiParams.faceScore);
          setFaceQuality(apiParams.faceQuality);
          setIsFront(apiParams.isFront);
          setIsLiveness(apiParams.isLiveness);
          setFacePreviewSize(apiParams.facePreviewSize);
          recognitionStorage.set(
            RECOGNITION_PARAMS_KEY,
            JSON.stringify(apiParams)
          );
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
          <TouchableOpacity style={styles.bottomButton}>
            <Text style={styles.buttonText}>刷脸记录</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.bottomButton,
            { backgroundColor: isBeginFace ? '#2fd9b1' : '#999999' },
          ]}
          disabled={!isBeginFace}
        >
          <Text style={styles.buttonText}>开始刷脸</Text>
        </TouchableOpacity>
      </View>

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
});

export default ArcSoftInfoScreen;
