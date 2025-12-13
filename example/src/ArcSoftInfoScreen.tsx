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
import { getCurrentUser } from './User';
import { apiFind } from './api';

const ArcSoftInfoScreen = () => {
  const [typetext, setTypetext] = useState('');
  const [outDataInfo, setOutDataInfo] = useState({ data2: [] });
  const [isFront, setIsFront] = useState(true);
  const [isLiveness, setIsLiveness] = useState(true);
  const [faceScore, setFaceScore] = useState(70);
  const [faceQuality, setFaceQuality] = useState(70);
  const [facePreviewSize, setFacePreviewSize] = useState('');
  const [listSize, setListSize] = useState([]);
  const [msg, setMsg] = useState('1'); // '1' for activated, '0' for not
  const [isBeginFace, setIsBeginFace] = useState(false);
  const [idtype, setIdtype] = useState(0);

  useEffect(() => {
    // Mocking navigation parameters
    const params = { idtype: 4, vccoursetype: '晚托', vcschool: '实验小学' };
    setIdtype(params.idtype);

    if (params.idtype === 1) {
      setTypetext(`校门口刷脸:${params.vccoursetype} [${params.vcschool}]`);
    } else if (params.idtype === 4) {
      setTypetext('托管刷脸：按时间段区分午托晚托');
      findInfo();
    }

    // Simulate device activation check
    // In a real app, this would call a native module
    setTimeout(() => {
      setMsg('1'); // Assume activated
      initfaceImg();
    }, 500);
  }, []);

  const findInfo = async () => {
    try {
      const res = await apiFind('szproctec',{
        procedure: 'st_pfm_config_face_se_init',
      });
      if (res?.data) {
        const resultSet1 = res.data['#result-set-1'];
        const resultSet2 = res.data['#result-set-2'];

        if (resultSet1 && resultSet1.length > 0) {
          const config = resultSet1[0];
          setFaceScore(Number(config.QIFACESCORE));
          setFaceQuality(Number(config.QIFACEWHILE));
          // Assuming VCFACENET '1' means front camera, empty or '0' means rear
          setIsFront(config.VCFACENET === '1');
          // Assuming ISFACELAST '1' means liveness enabled, '0' means disabled
          setIsLiveness(config.ISFACELAST === '1');
          setFacePreviewSize(config.QIFACESIZE);
        }

        if (resultSet2) {
          setOutDataInfo({ data2: resultSet2 });
        }
      }
    } catch (error) {
      Alert.alert('错误', '获取配置信息失败');
    }
  };

  const initfaceImg = () => {
    // Placeholder for native module calls to initialize face recognition
    console.log('Initializing face images...');
    // Simulate loading data and enabling the "start face recognition" button
    setTimeout(() => {
      setIsBeginFace(true);
    }, 1000);
  };

  const sliderChange = (value: number) => {
    setFaceScore(value);
  };

  const sliderQuality = (value: number) => {
    setFaceQuality(value);
  };

  const getSize = () => {
    // Placeholder for getting supported preview sizes from native module
    const sizes = [
      { VCNAME: '640x480' },
      { VCNAME: '1280x720' },
      { VCNAME: '1920x1080' },
    ];
    setListSize(sizes);
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
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(faceScore)}
              onChangeText={(text) => sliderChange(Number(text))}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>拍照质量:</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(faceQuality)}
              onChangeText={(text) => sliderQuality(Number(text))}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>分辨率:</Text>
            <Text>{facePreviewSize || '未设置'}</Text>
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
    marginBottom: 100, // Space for the bottom bar
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
