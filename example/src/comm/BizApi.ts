import { apiFind } from '../api';
import { getCurrentUser, User } from './User'; // 导入 User 类型

import Sound from 'react-native-sound';

// 允许在后台或静音模式下播放 (iOS)
Sound.setCategory('Playback');

let isSpeechPlaying = false; // 播放锁

/**
 * 从 currentUser 获取公共 API 参数
 * @param currentUser 当前用户对象
 * @returns 包含公共 API 参数的对象
 */
const getCommonApiParams = (currentUser: User) => {
  // 假设 g_vcnameprefix 可以从 IDORG 中提取，或者是一个固定值
  // 根据你提供的 g_vcnameprefix: "szstg"，我将尝试从 IDORG 提取前缀
  const g_vcnameprefix = currentUser.IDORG?.split('_')[0] || 'szstg';

  return {
    g_idorgmain: currentUser.IDORG || '',
    g_idopr: currentUser.ID || '',
    g_vcempin: currentUser.VCNAME || '',
    g_vctoken: currentUser.token || '',
    g_vcnameprefix: g_vcnameprefix,
  };
};

export const speechVcName = (aID: string | number) => {
  // 如果正在播，直接跳过，避免声音堆叠
  if (isSpeechPlaying) return;

  let vcurlvoc = '';
  if (aID && aID !== 0 && aID !== -1) {
    const currentUser = getCurrentUser(); // 从 getCurrentUser 获取 currentUser
    if (currentUser?.IDORG) {
      vcurlvoc = `https://dlx-face.oss-cn-shanghai.aliyuncs.com/${currentUser.IDORG}/vocname/${aID}.mp3`;
    } else {
      let musciPath = 'wzd.mp3';
      vcurlvoc = musciPath;
    }
  } else {
    let musciPath = 'wzd.mp3'
    vcurlvoc = musciPath;
  }

  isSpeechPlaying = true;

  // 网络音频加载，第二个参数必须是空字符串 ''
  const sound = new Sound(vcurlvoc, '', (error) => {
    if (error) {
      console.warn('音频加载失败:', vcurlvoc, error);
      isSpeechPlaying = false;
      return;
    }

    sound.play((success) => {
      if (!success) console.warn('播放中断');
      sound.release(); // 释放内存
      isSpeechPlaying = false;
    });
  });
};

/**
 * 解析时间字符串为数字（小时*60+分钟）
 */
const parseTimeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * 根据当前时间和配置信息判断签到/签退状态
 */
export const processCourseType = (data2: any[], callback?: (courseType: any) => void) => {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let isqd = 0;
  let isqt = 0;
  let idsigntype = 0;
  let typetext = '托管刷脸：未在刷脸时间段1';
  let faceText = '未在刷脸时间段';
  let idsigntypeold = 0; // 假设旧的签到类型为0

  // 查找签到时间段
  const qdList = data2?.filter((item: any) => {
    if (!item.ISQD || !item.DTQDS || !item.DTQDE) return false;
    const startTime = parseTimeToMinutes(item.DTQDS);
    const endTime = parseTimeToMinutes(item.DTQDE);
    return item.ISQD === '1' && currentMinutes >= startTime && currentMinutes <= endTime;
  });

  if (qdList && qdList.length === 1) {
    isqd = 1;
    idsigntype = Number(qdList[0].ID);
    faceText = qdList[0].VCNAME + '签到';
    typetext = '托管刷脸：' + faceText;
  }

  // 查找签退时间段
  const qtList = data2?.filter((item: any) => {
    if (!item.ISQT || !item.DTQTS || !item.DTQTE) return false;
    const startTime = parseTimeToMinutes(item.DTQTS);
    const endTime = parseTimeToMinutes(item.DTQTE);
    return item.ISQT === '1' && currentMinutes >= startTime && currentMinutes <= endTime;
  });

  if (qtList && qtList.length === 1) {
    isqt = 1;
    idsigntype = 100 + Number(qtList[0].ID); // '100' + qtList[0].ID 在原代码中是字符串拼接
    faceText = qtList[0].VCNAME + '签退';
    typetext = '托管刷脸：' + faceText;
  }

  // 如果不在任何时间段内
  if (idsigntype === 0) {
    typetext = '托管刷脸：未在刷脸时间段2';
    faceText = '未在刷脸时间段';
  }

  const courseType = {
    isqd,
    isqt,
    idsigntype,
    typetext,
    faceText,
    idsigntypeold
  };

  // 如果提供了回调函数，则执行它
  if (callback) {
    callback(courseType);
  }

  return courseType;
};

/**
 * 获取基础配置信息
 * 对应调用存储过程: st_pfm_config_face_se_init
 */
export const findInfo = async (onCourseTypeUpdate?: (courseType: any) => void) => {
  try {
    console.log('findInfo: 获取基础配置信息');
    const currentUser = getCurrentUser();
    if (!currentUser) {
      console.error("无法获取当前用户信息，请求被中止。");
      return null;
    }

    const commonParams = getCommonApiParams(currentUser);

    const result = await apiFind('szproctec', {
      procedure: 'st_pfm_config_face_se_init',
      i_idopr: currentUser.ID,
      ...commonParams, // 合并公共参数
    });

    console.log('findInfo result:', result);
  //"#result-set-2": [
    //       {
    //         "ID": "2",
    //         "VCNAME": "午托",
    //         "ISQD": "1",
    //         "DTQDS": "00:00",
    //         "DTQDE": "23:00",
    //         "ISQT": "0",
    //         "DTQTS": "00:00",
    //         "DTQTE": "00:00"
    //       }
    //     ]
    return result.data['#result-set-2'];
  } catch (error) {
    console.error('findInfo error:', error);
    throw error;
  }
};

/**
 * 获取学生列表
 * 对应调用存储过程: st_cou_course_student_up_se_sum
 */
export const findStu = async (
  idtype?: string | number,
  iddetail?: string | number,
  vctype?: string | number,
  vcschool?: string | number
) => {
  try {
    console.log('findStu: 获取学生列表');
    const currentUser = getCurrentUser();
    if (!currentUser) {
      console.error("无法获取当前用户信息，请求被中止。");
      return null;
    }

    const commonParams = getCommonApiParams(currentUser);

    const result = await apiFind('szproctec', {
      procedure: 'st_cou_course_student_up_se_sum',
      i_idopr: currentUser.ID,
      i_idcampus: currentUser.campusId,
      i_idtype: idtype,
      i_iddetail: iddetail,
      i_vctype: vctype,
      i_vcschool: vcschool,
      ...commonParams, // 合并公共参数
    });

    console.log('findStu result:', result);

    // 处理学生数据，去重
    const list = result.data['#result-set-1'] || []; // 使用 ?.data1 访问，与 dlx_video_compare.nvue 日志保持一致
    if (list.length > 0) {
      // 为去重后赋值
      const uniqueData = Array.from(new Map(list.map((item: any) => [item.ID, item])).values());
      console.log('Unique student data:', uniqueData);
      return uniqueData;
    }

  } catch (error) {
    console.error('findStu error:', error);
    throw error;
  }
};

/**
 * 获取教师列表
 * 对应调用存储过程: st_cou_teacher_up_se_detail2
 */
export const findTeacher = async () => {
  try {
    console.log('findTeacher: 获取教师列表');
    const currentUser = getCurrentUser();
    if (!currentUser) {
      console.error("无法获取当前用户信息，请求被中止。");
      return null;
    }

    const commonParams = getCommonApiParams(currentUser);

    const result = await apiFind('szproctec', {
      procedure: 'st_cou_teacher_up_se_detail2',
      i_idopr: currentUser.ID,
      i_idcampus: currentUser.campusId,
      ...commonParams, // 合并公共参数
    });

    console.log('findTeacher result:', result);

    return result.data['#result-set-1'];
  } catch (error) {
    console.error('findTeacher error:', error);
    throw error;
  }
};

/**
 * 判断用户是否在等待签到
 * @param userIdList 用户ID列表
 * @param studentData 学生数据列表
 * @param isqt 是否为签退状态 (1: 签退, 0: 签到)
 * @returns 如果userIdList中任何一个用户在等待签到/签退，返回true，否则返回false
 */
export const isWaitSignUser = (userIdList: string[], studentData: any[], isqt: number): boolean => {
  console.log("执行判断用户是否在等待签到=" + JSON.stringify(userIdList));

  if (!studentData || studentData.length === 0) {
    return false;
  }

  // 检查idList中是否存在任何一个userIdList中的用户ID
  if (isqt === 1) {
    // 签退逻辑：ISEND != 1
    const idList = studentData.filter((item) => {
      return item.ISEND != 1;
    }).map((e) => e.ID);

    console.log("执行判断用户是否在等待签到2=" + JSON.stringify(userIdList));
    // 检查idList中是否存在userIdList中的任何一个ID
    return userIdList.some(userId => idList.includes(userId));
  } else {
    // 签到逻辑：IDSTATUS == 0 || IDSTATUS == 3
    const idList = studentData.filter((item) => {
      return (item.IDSTATUS == 0 || item.IDSTATUS == 3);
    }).map((e) => e.ID);

    console.log("执行判断用户是否在等待签到3=" + JSON.stringify(userIdList));
    // 检查idList中是否存在userIdList中的任何一个ID
    return userIdList.some(userId => idList.includes(userId));
  }
};

/**
 * 并行调用 findInfo、findStu、findTeacher 三个接口，并处理结果
 */
export const fetchAllAndProcessCourseType = async () => {
  try {
    console.log('fetchAllAndProcessCourseType: 开始执行');

    // 并行调用三个接口
    const [findInfoResult, findStuResult, findTeacherResult] = await Promise.all([
      findInfo(),
      findStu(4,'','',''),
      findTeacher()
    ]);

    console.log('fetchAllAndProcessCourseType: 接口调用完成');

    // 处理课程类型
    const courseType = processCourseType(findInfoResult || []);

    console.log('fetchAllAndProcessCourseType: 成功返回结果');

    return {
      findInfo: findInfoResult,
      findStu: findStuResult,
      findTeacher: findTeacherResult,
      courseType
    };
  } catch (error) {
    console.error('fetchAllAndProcessCourseType: 接口调用失败', error);
    throw error;
  }
};

