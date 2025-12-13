import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from './LoginScreen';
import ArcSoftInfoScreen from './ArcSoftInfoScreen';
import RegisteredFacesScreen from './RegisteredFacesScreen';

const Stack = createNativeStackNavigator();

export default function App() {
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
