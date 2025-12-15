import { useFrameProcessor } from 'react-native-vision-camera'
import { runOnJS } from 'react-native-reanimated'

type FaceResult = {
  x: number
  y: number
  width: number
  height: number
  score: number
}

type OnFacesDetected = (faces: FaceResult[]) => void

export function useInspireFaceFrameProcessor(
  onFacesDetected: OnFacesDetected
) {
  return useFrameProcessor((frame) => {
    'worklet'

    // 1️⃣ 防御：JSI 不存在直接 return
    if (
      typeof global === 'undefined' ||
      // @ts-ignore
      global.InspireFace == null ||
      // @ts-ignore
      typeof global.InspireFace.detectFaces !== 'function'
    ) {
      return
    }

    // 2️⃣ 调用 InspireFace JSI（只做一件事）
    // @ts-ignore
    const faces = global.InspireFace.detectFaces(frame)

    // 3️⃣ 防御：必须是 Array
    if (!faces || faces.length === 0) {
      return
    }

    // 4️⃣ 回到 JS 主线程
    runOnJS(onFacesDetected)(faces)
  }, [onFacesDetected])
}
