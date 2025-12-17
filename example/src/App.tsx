import React, { useEffect } from 'react'; // 导入 useEffect
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Alert } from 'react-native'; // 导入 Alert

import LoginScreen from './LoginScreen';
import ArcSoftInfoScreen from './ArcSoftInfoScreen';
import RegisteredFacesScreen from './RegisteredFacesScreen';
import FaceShowScreen from './FaceShow';
import { SkiaDemoScreen } from './SkiaDemoScreen';

import {
  InspireFace,
  SearchMode,
  PrimaryKeyMode,
} from 'react-native-nitro-inspire-face'; // 导入 InspireFace 及其相关枚举

// 定义 RootStackParamList 类型，以匹配 ArcSoftInfoScreen 中的定义
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
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  useEffect(() => {
    try {
      InspireFace.launch('Pikachu');
      InspireFace.featureHubDataEnable({
        enablePersistence: true,
        persistenceDbPath: 'inspireface.db',
        searchThreshold: 0.42, // 默认搜索阈值
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
          component={ArcSoftInfoScreen}
          options={{ title: '人脸识别设置' }}
        />
        <Stack.Screen
          name="RegisteredFaces"
          component={RegisteredFacesScreen}
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
