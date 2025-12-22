import { MMKV } from 'react-native-mmkv';
import {InspireFace, PrimaryKeyMode, SearchMode} from "react-native-nitro-inspire-face";

// 全局MMKV存储实例
export const recognitionStorage = new MMKV({
  id: 'recognition-params-storage',
});

export const faceVersionStorage = new MMKV({
  id: 'face-version-storage',
});

export const userStorage = new MMKV({
  id: 'login-credentials',
});

/**
 *  人脸ID映射存储
 *  */
export const faceIdMappingStorage = new MMKV({
  id: 'face-id-mapping-storage',
});
/**
 *  用户信息缓存存储
 *  */
export const userInfoCacheStorage = new MMKV({
  id: 'user-info-cache-storage',
});

// 存储键常量
export const STORAGE_KEYS = {
  RECOGNITION_PARAMS: 'recognition_params',
  CURRENT_USER: 'current_user',
  REGISTERED_FACES: 'registeredFaces',
};
export const DLX_CONFIG = {
  USER_DB_PATH: 'dlx_user.db',//模型数据库路径
  INSPIREFACE_MODEL_NAME: 'Pikachu',// 模型名称
  INSPIREFACE_DB_PATH: 'dlx_face.db',//模型数据库路径
  INSPIREFACE_SEARCH_THRESHOLD: 0.42, // 优化后的搜索阈值
  INSPIREFACE_SEARCH_MODE: SearchMode.EXHAUSTIVE,
  INSPIREFACE_SRC_W: 320,// 模型输入图片宽度
  INSPIREFACE_SRC_H: 320,// 模型输入图片高度
  INSPIREFACE_FACE_DETECT_THRESHOLD: 0.6, // 人脸检测阈值
  INSPIREFACE_CONFIDENCE_THRESHOLD: 0.6, // 置信度阈值
  INSPIREFACE_TRACK_MODE_SMOOTH_RATIO: 0.7, // 人脸跟踪平滑比例
  INSPIREFACE_TRACK_MODE_DETECT_INTERVAL: 10, // 人脸跟踪检测间隔
  INSPIREFACE_FILTER_MINIMUM_FACE_PIXEL_SIZE: 50, // 最小人脸像素大小
  INSPIREFACE_FRAME_PROCESSOR_FPS: 15, // 帧处理器帧率
  FACE_BOX_Y_OFFSET_RATIO: 0.2, // 调整人脸框位置：向上偏移比例（解决框偏下问题）
};
