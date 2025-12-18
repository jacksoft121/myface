import { config } from './comm/config';
import {getCurrentUser} from "./comm/User";

export const apiFind = async (func: string,params: Record<string, any>) => {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    console.error("无法获取当前用户信息，请求被中止。");
    return;
  }
  let urlfind = currentUser.urlfind;
  const baseUrl = urlfind+"?func="+func;

  const body = new URLSearchParams();
  for (const key in params) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      body.append(key, params[key]);
    }
  }

  // 不再自动添加 i_idopr。让调用者明确提供。
  // if (params.ID == null) {
  //     body.append('i_idopr', currentUser.ID);
  // }

  // 自动添加 token
  if (params.g_vctoken == null) {
      body.append('g_vctoken', currentUser.token);
  }

  console.log('POST Request Body:', body.toString());

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const responseText = await response.text();
    console.log('API Raw Response:', responseText);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = JSON.parse(responseText);
    console.log('API Parsed Response:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
};


export const apiLogin = async (func: string,params: Record<string, any>) => {
  const baseUrl = config.baseUrl+"?func="+func;

  const body = new URLSearchParams();
  for (const key in params) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      body.append(key, params[key]);
    }
  }

  console.log('POST Request Body:', body.toString());

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const responseText = await response.text();
    console.log('API Raw Response:', responseText);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = JSON.parse(responseText);
    console.log('API Parsed Response:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
};
