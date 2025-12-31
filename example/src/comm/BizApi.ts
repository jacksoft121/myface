import { apiFind } from '../api';
import { getCurrentUser } from './User';

import Sound from 'react-native-sound';

// 允许在后台或静音模式下播放 (iOS)
Sound.setCategory('Playback');

let isSpeechPlaying = false; // 播放锁

export const speechVcName = (aID: string | number) => {
  // 如果正在播，直接跳过，避免声音堆叠
  if (isSpeechPlaying) return;

  let vcurlvoc = '';
  if (aID && aID !== 0 && aID !== -1) {
    // 假设这里的 getCurrentUser 能拿到 IDORG
    const currentUser = (global as any).currentUser;
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

    const result = await apiFind('szproctec', {
      procedure: 'st_pfm_config_face_se_init',
      i_idopr: currentUser.ID,
    });

    console.log('findInfo result:', result);

    return result.data['#result-set-1'];
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
  campusId?: string | number,
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

    const result = await apiFind('szproctec', {
      procedure: 'st_cou_course_student_up_se_sum',
      i_idopr: currentUser.ID,
      i_idcampus: campusId || currentUser.campusId, // 使用传入的校园ID或当前用户的校园ID
      i_idtype: idtype,
      i_iddetail: iddetail,
      i_vctype: vctype,
      i_vcschool: vcschool
    });

    console.log('findStu result:', result);

    // 处理学生数据，去重
    const list = result.data['#result-set-1'] || [];
    if (list) {
      // 为去重后赋值
      const uniqueData = Array.from(new Map(list.map((item: any) => [item.ID, item])).values());
      console.log('Unique student data:', uniqueData);
      return uniqueData;
    }

    return result;
  } catch (error) {
    console.error('findStu error:', error);
    throw error;
  }
};

/**
 * 获取教师列表
 * 对应调用存储过程: st_cou_teacher_up_se_detail2
 */
export const findTeacher = async (campusId?: string | number) => {
  try {
    console.log('findTeacher: 获取教师列表');
    const currentUser = getCurrentUser();
    if (!currentUser) {
      console.error("无法获取当前用户信息，请求被中止。");
      return null;
    }

    const result = await apiFind('szproctec', {
      procedure: 'st_cou_teacher_up_se_detail2',
      i_idopr: currentUser.ID,
      i_idcampus: campusId || currentUser.campusId, // 使用传入的校园ID或当前用户的校园ID
    });

    console.log('findTeacher result:', result);
    return result.data['#result-set-1'];
  } catch (error) {
    console.error('findTeacher error:', error);
    throw error;
  }
};

/**
 * 同时调用三个接口，全部成功后执行setCurCoursetype逻辑
 */
export const fetchAllAndProcessCourseType = async (
  idtype?: string | number,
  iddetail?: string | number,
  vctype?: string | number,
  vcschool?: string | number
) => {
  try {
    console.log('fetchAllAndProcessCourseType: 开始并行调用三个接口');
    const currentUser = getCurrentUser();
    const campusId = currentUser.campusId || '';
    // 并行调用三个接口
    const [infoResult, stuResult, teacherResult] = await Promise.all([
      findInfo(),
      findStu(campusId, idtype, iddetail, vctype, vcschool),
      findTeacher(campusId)
    ]);

    console.log('fetchAllAndProcessCourseType: 三个接口调用完成');
    console.log('infoResult:', infoResult);
    console.log('stuResult:', stuResult);
    console.log('teacherResult:', teacherResult);

    // 检查是否所有接口都成功返回了数据
    if (infoResult !== null && stuResult !== null && teacherResult !== null) {
      console.log('fetchAllAndProcessCourseType: 所有接口调用成功，返回结果');
      // 在获取数据后处理课程类型
      processCourseType(infoResult);
      return {
        infoData: infoResult,
        stuData: stuResult,
        teacherData: teacherResult
      };
    } else {
      console.error('fetchAllAndProcessCourseType: 某个接口调用失败');
      throw new Error('一个或多个接口调用失败');
    }
  } catch (error) {
    console.error('fetchAllAndProcessCourseType error:', error);
    throw error;
  }
};
