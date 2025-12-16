import { useCameraDevice, useSkiaFrameProcessor, Camera } from 'react-native-vision-camera';
import { useSharedValue } from 'react-native-reanimated';
import { Skia } from '@shopify/react-native-skia';
// Assume you have a face detection plugin installed
import { detectFaces } from 'react-native-vision-camera-face-detector';

function App() {
  const device = useCameraDevice('back');
  // Shared value to hold the results from the ML Kit plugin
  const faces = useSharedValue([]);

  // Frame processor for ML Kit detection
  const mlkItProcessor = useFrameProcessor((frame) => {
    'worklet';
    const detectedFaces = detectFaces(frame);
    // Update the shared value with results (e.g., bounding boxes)
    faces.value = detectedFaces;
  }, []);

  // Skia Frame Processor for drawing
  const skiaFrameProcessor = useSkiaFrameProcessor((frame) => {
    'worklet';
    // Must always call render() to show the camera feed
    frame.render();

    const detectedFaces = faces.value;
    // Draw using Skia APIs based on the ML Kit results
    if (detectedFaces.length > 0) {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color('red'));

      detectedFaces.forEach(face => {
        // You'll need math to normalize coordinates from frame size to actual preview size
        const rect = Skia.XYWHRect(face.x, face.y, face.width, face.height);
        frame.drawRect(rect, paint);
      });
    }
  }, [faces]); // Re-run if faces shared value changes

  if (device == null) return <NoCameraErrorView />;
  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={true}
      // Use the Skia frame processor as the primary processor
      frameProcessor={skiaFrameProcessor}
      // Ensure the ML Kit plugin is also active in background
      // The ML Kit plugin is called within its own useFrameProcessor hook
    />
  );
}
