import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { MMKV } from 'react-native-mmkv';
import Slider from '@react-native-community/slider'; // 导入 Slider 组件
import { getCurrentUser } from './User';
import { apiFind } from './api';

// 为识别参数创建一个单独的 MMKV 存储实例
const recognitionStorage = new MMKV({
  id: 'recognition-params-storage',
});

const RECOGNITION_PARAMS_KEY = 'recognition_params';

const ArcSoftInfoScreen = () => {
  const [typetext, setTypetext] = useState('');
  const [outDataInfo, setOutDataInfo] = useState({ data2: [] });

  // 识别参数的状态
  const [isFront, setIsFront] = useState(true);
  const [isLiveness, setIsLiveness] = useState(true);
  const [faceScore, setFaceScore] = useState(70);
  const [faceQuality, setFaceQuality] = useState(70);
  const [facePreviewSize, setFacePreviewSize] = useState('');

  const [listSize, setListSize] = useState([]);
  const [msg, setMsg] = useState('1'); // '1' 已激活, '0' 未激活
  const [isBeginFace, setIsBeginFace] = useState(false);
  const [idtype, setIdtype] = useState(0);
  const [paramsInitialized, setParamsInitialized] = useState(false);

  // 组件加载时的主 effect
  useEffect(() => {
    const loadScreenData = async () => {
      await findInfo();
      try {
        const savedParamsString = recognitionStorage.getString(RECOGNITION_PARAMS_KEY);
        if (savedParamsString) {
          console.log('从 MMKV 加载已保存的识别参数...');
          const savedParams = JSON.parse(savedParamsString);
          setFaceScore(savedParams.faceScore);
          setFaceQuality(savedParams.faceQuality);
          setIsFront(savedParams.isFront);
          setIsLiveness(savedParams.isLiveness);
          setFacePreviewSize(savedParams.facePreviewSize);
        } else {
          console.log('MMKV 中没有识别参数缓存。');
        }
      } catch (error) {
        console.error('从 MMKV 加载参数失败:', error);
      } finally {
        setParamsInitialized(true);
      }
    };

    loadScreenData();

    const params = { idtype: 4, vccoursetype: '晚托', vcschool: '实验小学' };
    setIdtype(params.idtype);

    if (params.idtype === 1) {
      setTypetext(`校门口刷脸:${params.vccoursetype} [${params.vcschool}]`);
    } else if (params.idtype === 4) {
      setTypetext('托管刷脸：按时间段区分午托晚托');
    }

    setTimeout(() => {
      setMsg('1');
      initfaceImg();
    }, 500);
  }, []);

  // 当识别参数发生变化时，自动保存到 MMKV
  useEffect(() => {
    if (!paramsInitialized) {
      return;
    }
    const saveParamsToMmkv = () => {
      const paramsToSave = {
        faceScore,
        faceQuality,
        isFront,
        isLiveness,
        facePreviewSize,
      };
      console.log('识别参数已修改，保存到 MMKV:', paramsToSave);
      recognitionStorage.set(RECOGNITION_PARAMS_KEY, JSON.stringify(paramsToSave));
    };
    saveParamsToMmkv();
  }, [isFront, isLiveness, faceScore, faceQuality, facePreviewSize, paramsInitialized]);

  // 从 API 获取所有数据
  const findInfo = async () => {
    try {
      const res = await apiFind('szproctec', {
        procedure: 'st_pfm_config_face_se_init',
      });
      if (res?.data) {
        const resultSet1 = res.data['#result-set-1'];
        const resultSet2 = res.data['#result-set-2'];

        if (resultSet2) {
          console.log('从 API 更新签到时间数据...');
          setOutDataInfo({ data2: resultSet2 });
        }

        const hasCachedParams = recognitionStorage.contains(RECOGNITION_PARAMS_KEY);
        if (!hasCachedParams && resultSet1 && resultSet1.length > 0) {
          const config = resultSet1[0];
          console.log('使用 API 数据作为初始识别参数:', config);

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

          recognitionStorage.set(RECOGNITION_PARAMS_KEY, JSON.stringify(apiParams));
        }
      }
    } catch (error) {
      Alert.alert('错误', '获取配置信息失败');
    }
  };

  const initfaceImg = () => {
    console.log('Initializing face images...');
    setTimeout(() => {
      setIsBeginFace(true);
    }, 1000);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container}>
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
          <View style={{ alignItems: 'center', marginVertical: 10 }}>
            <Button title="重新载入照片" onPress={initfaceImg} />
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 15,
    marginBottom: 100,
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
});

export default ArcSoftInfoScreen;
