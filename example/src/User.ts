import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({
  id: 'login-credentials',
});

const STORAGE_KEYS = {
  CURRENT_USER: 'current_user',
};

export const getCurrentUser = () => {
  try {
    const userJson = storage.getString(STORAGE_KEYS.CURRENT_USER);
    if (userJson) {
      return JSON.parse(userJson);
    }
    return null;
  } catch (error) {
    console.error('Failed to retrieve user data:', error);
    return null;
  }
};
