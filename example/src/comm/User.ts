
import { userStorage, STORAGE_KEYS } from './GlobalStorage';

const STORAGE_KEYS_LOCAL = {
  CURRENT_USER: STORAGE_KEYS.CURRENT_USER,
};

export const getCurrentUser = () => {
  try {
    const userJson = userStorage.getString(STORAGE_KEYS_LOCAL.CURRENT_USER);
    if (userJson) {
      return JSON.parse(userJson);
    }
    return null;
  } catch (error) {
    console.error('Failed to retrieve user data:', error);
    return null;
  }
};

// 如果还有其他使用存储的方法，也需要相应更新
