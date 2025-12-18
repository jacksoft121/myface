import React, { useEffect } from 'react'; // 导入 useEffect
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Alert } from 'react-native'; // 导入 Alert

import LoginScreen from './LoginScreen';
import SettingFace from './SettingFace';
import RegisterFaces from './RegisterFaces';
import FaceShowScreen from './FaceShow';
import { SkiaDemoScreen } from './SkiaDemoScreen';
import Apptest from './Apptest'; // 导入 Apptest
import RealTimeRecognitionScreen from './RealTimeRecognitionScreen'; // 导入 RealTimeRecognitionScreen

import {
  InspireFace,
  SearchMode,
  PrimaryKeyMode,
} from 'react-native-nitro-inspire-face'; // 导入 InspireFace 及其相关枚举

// 定义 RootStackParamList 类型，以匹配 SettingFace 中的定义
export type RootStackParamList = {
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
  Apptest: undefined; // 添加 Apptest
  RealTimeRecognition: undefined; // 添加 RealTimeRecognition
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  useEffect(() => {
    try {
      InspireFace.launch('Pikachu');
      InspireFace.featureHubDataEnable({
        enablePersistence: true,
        persistenceDbPath: 'dlx_szstg.db',
        searchThreshold: 0.42, // 优化后的搜索阈值
        searchMode: SearchMode.EXHAUSTIVE,
        primaryKeyMode: PrimaryKeyMode.AUTO_INCREMENT,
      });
      console.log('InspireFace initialized successfully in App.tsx');
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
          options={{ title: '登录' }}
        />
        <Stack.Screen
          name="ArcSoftInfo"
          component={SettingFace}
          options={{ title: '人脸识别设置' }}
        />
        <Stack.Screen
          name="RegisteredFaces"
          component={RegisterFaces}
          options={{ title: '已注册的人脸' }}
        />
        <Stack.Screen
          name="FaceShow"
          component={FaceShowScreen}
          options={{ title: '人脸识别' }}
        />
        <Stack.Screen
          name="SkiaDemo"
          component={SkiaDemoScreen}
          options={{ title: 'Skia Demo' }}
        />
        <Stack.Screen
          name="Apptest"
          component={Apptest}
          options={{ title: 'Apptest' }}
        />
        <Stack.Screen
          name="RealTimeRecognition"
          component={RealTimeRecognitionScreen}
          options={{ title: '实时识别' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
