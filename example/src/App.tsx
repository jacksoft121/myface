import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from './LoginScreen';
import SettingFace from './SettingFace';
import RegisteredFacesScreen from './RegisterFaces';

import RealTimeRecognitionScreen from './RealTimeRecognitionScreen';
import { initFaceDB } from "./comm/FaceDB";
import {InspireFace, PrimaryKeyMode} from "react-native-nitro-inspire-face";
import {DLX_CONFIG} from "./comm/GlobalStorage";
import {Alert} from "react-native"; // 导入 initFaceDB

const Stack = createNativeStackNavigator();

function App(): React.JSX.Element {
  useEffect(() => {
    try {
      InspireFace.launch(DLX_CONFIG.INSPIREFACE_MODEL_NAME);
      InspireFace.featureHubDataEnable({
        enablePersistence: true,
        persistenceDbPath: DLX_CONFIG.INSPIREFACE_DB_PATH,
        searchThreshold: DLX_CONFIG.INSPIREFACE_SEARCH_THRESHOLD, // 优化后的搜索阈值
        searchMode: DLX_CONFIG.INSPIREFACE_SEARCH_MODE,
        primaryKeyMode: PrimaryKeyMode.AUTO_INCREMENT,
      });
      console.log('InspireFace initialized successfully in App.tsx');
      initFaceDB();
    } catch (e) {
      Alert.alert('InspireFace 引擎启动失败', (e as Error).message);
      console.error('InspireFace initialization failed:', e);
    }
  }, []); // 空数组表示只在组件挂载时运行一次

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingFace"
          component={SettingFace}
          options={{ title: '人脸识别参数设置' }}
        />
        <Stack.Screen
          name="FaceShow"
          component={RealTimeRecognitionScreen}
          options={{ title: '实时人脸识别' }}
        />
        <Stack.Screen
          name="RegisteredFaces"
          component={RegisteredFacesScreen}
          options={{ title: '已注册人脸' }}
        />

      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default App;
