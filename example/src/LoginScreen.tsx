import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  Dimensions,
  ScrollView,
  ImageBackground,
} from 'react-native';

interface LoginScreenProps {
  onLoginSuccess: (userData: any) => void;
}

// Placeholder for apiFind function
const apiFind = async (endpoint: string, params: any) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (endpoint === 'tecloginbyphone') {
        if (params.I_VCPHONE === '12345678900' && params.I_VCPWD === 'password') {
          resolve({
            data1: [{
              o_issuc: '1',
              o_msg: '登录成功',
              VCNAMECUST: '示例机构',
              VCPHONE: params.I_VCPHONE,
              ID: 'user123',
              IDORG: 'org456',
            }],
          });
        } else {
          resolve({
            data1: [{
              o_issuc: '0',
              o_msg: '手机号或密码错误',
            }],
          });
        }
      } else {
        reject(new Error('未知接口'));
      }
    }, 1000);
  });
};

const { width, height } = Dimensions.get('window');
const rpx = (px: number) => (width / 750) * px;

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [phone, setPhone] = useState('');
  const [codeChecked, setCodeChecked] = useState('');

  const handleLogin = async () => {
    if (!phone || !codeChecked) {
      Alert.alert('错误', '请输入账号和密码');
      return;
    }

    try {
      const response: any = await apiFind('tecloginbyphone', {
        funcapi: 'tecloginbyphone',
        I_VCPHONE: phone,
        I_VCPWD: codeChecked,
      });

      if (response.data1 && response.data1[0].o_issuc === '1') {
        onLoginSuccess(response.data1[0]);
      } else {
        Alert.alert('登录失败', response.data1 ? response.data1[0].o_msg : '未知错误');
      }
    } catch (error) {
      console.error('登录请求失败:', error);
      Alert.alert('错误', '登录请求失败，请稍后再试');
    }
  };

  return (
    <ImageBackground source={require('./static/icon/logbg.png')} style={styles.fullBackground}>
      <ScrollView contentContainerStyle={styles.scrollViewContainer}>
        {/* Decorative Images from login.vue, layered as requested */}
        <Image source={require('./static/icon/xian.png')} style={styles.img3} />
        <Image source={require('./static/icon/tencher.png')} style={styles.img2} />
        <Image source={require('./static/icon/logo_szstg.png')} style={styles.img1} />
        <View style={styles.img4} />
        <View style={styles.img5} />

        <View style={styles.headerTextContainer}>
          <Text style={styles.prodName}>数智托管</Text>
          <Text style={styles.subtitle}>Let every child have a dream</Text>
        </View>

        <View style={styles.bottomSection}>
          <View style={styles.form}>
            <Text style={styles.inputText}>请输入账号</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} />
            <Text style={styles.inputText}>请输入密码</Text>
            <TextInput style={styles.input} value={codeChecked} onChangeText={setCodeChecked} secureTextEntry />
            <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
              <Text style={styles.loginButtonText}>登 录</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  fullBackground: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  scrollViewContainer: {
    minHeight: height,
    position: 'relative',
  },
  headerTextContainer: {
    position: 'absolute',
    top: rpx(150),
    right: rpx(60),
    alignItems: 'flex-end',
  },
  prodName: {
    fontSize: rpx(56),
    fontWeight: '500',
    color: '#333', // Adjust color for visibility on background
  },
  subtitle: {
    fontSize: rpx(28),
    fontWeight: '400',
    color: '#555', // Adjust color for visibility
  },
  img1: { // logo
    width: rpx(136),
    height: rpx(136),
    position: 'absolute',
    top: rpx(264),
    left: rpx(60),
    zIndex: 2,
  },
  img2: { // tencher.png
    width: rpx(452),
    height: rpx(400),
    position: 'absolute',
    top: rpx(372),
    left: rpx(150),
    zIndex: 1,
  },
  img3: { // xian.png
    width: rpx(560),
    height: rpx(464),
    position: 'absolute',
    top: rpx(328),
    left: rpx(60),
    zIndex: 0,
  },
  img4: { // left circle
    position: 'absolute',
    top: rpx(468),
    left: rpx(-150),
    width: rpx(150),
    height: rpx(150),
    backgroundColor: 'rgba(172, 238, 221, 0.5)',
    borderRadius: rpx(75),
    borderWidth: rpx(48),
    borderColor: 'rgba(172, 238, 221, 0.7)',
    zIndex: 0,
  },
  img5: { // right circle
    position: 'absolute',
    top: rpx(630),
    right: rpx(-150),
    width: rpx(150),
    height: rpx(150),
    backgroundColor: 'rgba(172, 238, 221, 0.5)',
    borderRadius: rpx(75),
    borderWidth: rpx(48),
    borderColor: 'rgba(172, 238, 221, 0.7)',
    zIndex: 0,
  },
  bottomSection: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: rpx(80),
    borderTopRightRadius: rpx(80),
    borderRadius: rpx(80),
    paddingBottom: rpx(60),
    position: 'absolute',
    bottom: rpx(300),
  },
  form: {
    paddingHorizontal: rpx(25),
    paddingTop: rpx(50),
  },
  inputText: {
    marginLeft: rpx(20),
    fontSize: rpx(28),
    color: '#858597',
    marginBottom: rpx(10),
  },
  input: {
    marginBottom: rpx(10),
    paddingLeft: rpx(20),
    fontSize: rpx(32),
    marginLeft: rpx(15),
    width: rpx(654),
    letterSpacing: 4,
    borderWidth: 1,
    borderColor: '#B8B8D2',
    height: rpx(80),
    borderRadius: rpx(20),
    alignSelf: 'center',
  },
  loginButton: {
    width: '90%',
    height: rpx(85),
    borderRadius: rpx(20),
    backgroundColor: '#2fd9b1',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: rpx(30),
    marginBottom: rpx(30),
    alignSelf: 'center',
  },
  loginButtonText: {
    fontSize: rpx(32),
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default LoginScreen;
