import { MMKV } from 'react-native-mmkv';

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
