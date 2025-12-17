import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { Canvas, Circle, Group } from '@shopify/react-native-skia';
import {
  Camera, useCameraDevice,
  useCameraDevices,
  useFrameProcessor,
} from 'react-native-vision-camera';

export const SkiaDemoScreen = () => {
  // Prefer front camera for simulators and general use
  const device = useCameraDevice('front');

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    // You can process the frame here, for example, run face detection.
    // The results can then be used to draw on the Skia canvas.
    // Note: console.log inside a worklet might not appear in the metro bundler log.
    // Use more advanced debugging techniques if needed.
  }, []);

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.text}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>
          Camera permission has not been granted.
        </Text>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>No camera device found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />
      <Canvas style={StyleSheet.absoluteFill}>
        <Group blendMode="multiply">
          <Circle cx={100} cy={100} r={50} color="cyan" />
          <Circle cx={200} cy={100} r={50} color="magenta" />
          <Circle cx={150} cy={200} r={50} color="yellow" />
        </Group>
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
  text: {
    color: 'white',
    fontSize: 16,
    marginTop: 10,
  },
});
