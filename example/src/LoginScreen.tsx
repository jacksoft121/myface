import React, { useState, useEffect } from 'react';
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
import { MMKV } from 'react-native-mmkv';
import { apiFind,apiLogin } from './api';

interface LoginScreenProps {
  onLoginSuccess: (userData: any) => void;
}

const storage = new MMKV({
  id: 'login-credentials',
});

const STORAGE_KEYS = {
  REMEMBER_ME: 'remember_me',
  USER_PHONE: 'user_phone',
  USER_PASSWORD: 'user_password',
  CURRENT_USER: 'current_user',
};

const { width, height } = Dimensions.get('window');
const rpx = (px: number) => (width / 750) * px;

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [phone, setPhone] = useState('');
  const [codeChecked, setCodeChecked] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    const loadSavedCredentials = () => {
      try {
        const savedRememberMe = storage.getBoolean(STORAGE_KEYS.REMEMBER_ME);
        if (savedRememberMe) {
          setRememberMe(true);
          const savedPhone = storage.getString(STORAGE_KEYS.USER_PHONE);
          const savedPassword = storage.getString(STORAGE_KEYS.USER_PASSWORD);

          if (savedPhone) setPhone(savedPhone);
          if (savedPassword) setCodeChecked(savedPassword);
        }
      } catch (error) {
        console.error('加载保存的登录信息失败:', error);
      }
    };

    loadSavedCredentials();
  }, []);

  const processLogin = (userData: any) => {
    if (rememberMe) {
      storage.set(STORAGE_KEYS.REMEMBER_ME, true);
      storage.set(STORAGE_KEYS.USER_PHONE, phone);
      storage.set(STORAGE_KEYS.USER_PASSWORD, codeChecked);
    } else {
      storage.delete(STORAGE_KEYS.REMEMBER_ME);
      storage.delete(STORAGE_KEYS.USER_PHONE);
      storage.delete(STORAGE_KEYS.USER_PASSWORD);
    }
    storage.set(STORAGE_KEYS.CURRENT_USER, JSON.stringify(userData));
    onLoginSuccess(userData);
  };

  const handleLogin = async () => {
    if (!phone || !codeChecked) {
      Alert.alert('错误', '请输入账号和密码');
      return;
    }

    try {
      const response: any = await apiLogin('tecloginbyphone',{
        funcapi: 'tecloginbyphone',
        procedure: '',
        I_VCPHONE: phone,
        I_VCPWD: codeChecked,
        g_vcnameprefix: 'szstg',
      });

      const resultSet = response?.data?.['#result-set-1'];

      if (resultSet && resultSet.length > 0) {
        if (resultSet[0].o_issuc === '0') {
          Alert.alert('登录失败', resultSet[0].o_msg || '没有此用户或用户名密码错误');
        } else if (resultSet.length === 1) {
          processLogin(resultSet[0]);
        } else {
          const options = resultSet.map((org: any) => ({
            text: `${org.VCNAMECUST}(${org.VCPHONE})`,
            onPress: () => processLogin(org),
          }));
          options.push({ text: '取消', style: 'cancel' });
          Alert.alert('请选择您要登录的机构', '', options);
        }
      } else {
        Alert.alert('登录失败', '没有找到此用户');
      }
    } catch (error) {
      console.error('登录请求失败:', error);
      Alert.alert('错误', '登录请求失败，请稍后再试');
    }
  };

  const toggleRememberMe = () => {
    setRememberMe(!rememberMe);
  };

  return (
    <ImageBackground source={require('./static/icon/logbg.png')} style={styles.fullBackground}>
      <ScrollView contentContainerStyle={styles.scrollViewContainer}>
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
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="请输入手机号"
              placeholderTextColor="#B8B8D2"
            />
            <Text style={styles.inputText}>请输入密码</Text>
            <TextInput
              style={styles.input}
              value={codeChecked}
              onChangeText={setCodeChecked}
              secureTextEntry
              placeholder="请输入密码"
              placeholderTextColor="#B8B8D2"
            />

            <View style={styles.rememberMeContainer}>
              <TouchableOpacity
                style={styles.checkboxContainer}
                onPress={toggleRememberMe}
              >
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                  {rememberMe && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.rememberMeText}>记住密码</Text>
              </TouchableOpacity>
            </View>

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
    color: '#333',
  },
  subtitle: {
    fontSize: rpx(28),
    fontWeight: '400',
    color: '#555',
  },
  img1: {
    width: rpx(136),
    height: rpx(136),
    position: 'absolute',
    top: rpx(264),
    left: rpx(60),
    zIndex: 2,
  },
  img2: {
    width: rpx(452),
    height: rpx(400),
    position: 'absolute',
    top: rpx(372),
    left: rpx(150),
    zIndex: 1,
  },
  img3: {
    width: rpx(560),
    height: rpx(464),
    position: 'absolute',
    top: rpx(328),
    left: rpx(60),
    zIndex: 0,
  },
  img4: {
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
  img5: {
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
    paddingBottom: rpx(110),
    position: 'absolute',
    bottom: 0,
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
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: rpx(20),
    marginLeft: rpx(15),
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: rpx(40),
    height: rpx(40),
    borderWidth: 2,
    borderColor: '#B8B8D2',
    borderRadius: rpx(6),
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: rpx(10),
  },
  checkboxChecked: {
    backgroundColor: '#2fd9b1',
    borderColor: '#2fd9b1',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: rpx(24),
    fontWeight: 'bold',
  },
  rememberMeText: {
    fontSize: rpx(28),
    color: '#858597',
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
