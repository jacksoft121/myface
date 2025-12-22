import {
  InspireFace,
  type InspireFaceSession,
  CameraRotation,
  ImageFormat,
} from 'react-native-nitro-inspire-face';
import RNFS from 'react-native-fs';
import { apiFind } from '../api';
import {
  insertName,
  queryUsersByOrgId,
  deleteUsersByOrgId, getAllUsers,
} from './FaceDB';

// Helper to force UI update
const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

type LogEntry = {
  text: string;
  type: 'log' | 'error' | 'success';
};

type Campus = {
  ID: number;
  VCNAME: string;
};

export type ProgressCallback = (detail: string, type?: LogEntry['type']) => Promise<void>;

export type RegistrationProgress = {
  total: number;
  current: number;
  failed: number;
  logs: LogEntry[];
  isComplete: boolean;
  isSuccess: boolean;
  elapsedTime: string;
};

export class FaceRegistrationService {
  private session: InspireFaceSession | null = null;

  constructor(session: InspireFaceSession | null) {
    this.session = session;
  }

  /**
   * 从URL提取人脸特征
   */
  async extractFeatureFromUrlSession(
    imageUrl: string,
    session: InspireFaceSession,
    onProgress: ProgressCallback
  ): Promise<ArrayBuffer | null> {
    if (!imageUrl || !session) {
      return null;
    }
    const tempFilePath = `${
      RNFS.CachesDirectoryPath
    }/${new Date().getTime()}.jpg`;
    let bitmap = null;
    let imageStream = null;
    try {
      await onProgress('正在下载图片...');
      const download = await RNFS.downloadFile({
        fromUrl: imageUrl,
        toFile: tempFilePath,
      }).promise;
      if (download.statusCode !== 200) {
        await onProgress('图片下载失败', 'error');
        return null;
      }

      await onProgress('正在创建图像流...');
      bitmap = InspireFace.createImageBitmapFromFilePath(3, tempFilePath);
      imageStream = InspireFace.createImageStreamFromBitmap(
        bitmap,
        CameraRotation.ROTATION_0
      );
      imageStream.setFormat(ImageFormat.BGR);

      await onProgress('正在检测人脸...');
      const faceInfos = session.executeFaceTrack(imageStream);
      if (faceInfos.length > 0 && faceInfos[0]) {
        await onProgress('正在提取特征...');
        return session.extractFaceFeature(imageStream, faceInfos[0].token);
      }
      await onProgress('未检测到人脸', 'error');
      return null;
    } catch (error) {
      const errMsg = (error as Error).message;
      await onProgress(`处理图片时出错: ${errMsg}`, 'error');
      console.error(`处理图片时出错 ${imageUrl}:`, error);
      return null;
    } finally {
      imageStream?.dispose();
      bitmap?.dispose();
      RNFS.unlink(tempFilePath).catch(() => {});
    }
  }

  /**
   * 重新载入照片
   */
  async reloadCampusPhotos(
    selectedCampus: Campus,
    onProgress: ProgressCallback,
    onProgressUpdate: (progress: RegistrationProgress) => void
  ) {
    if (!selectedCampus) {
      await onProgress('请先选择一个校区', 'error');
      return;
    }
    if (!this.session) {
      await onProgress('人脸识别会话未初始化', 'error');
      return;
    }

    const startTime = performance.now();
    let wasSuccessful = true;
    let failedCount = 0;

    const updateProgress = async (detail: string, type: LogEntry['type'] = 'log') => {
      if (type === 'error') {
        wasSuccessful = false;
        failedCount++;
      }
      console.log(`[进度] ${detail}`);
      await onProgress(detail, type);
      await yieldToMain();
    };

    await updateProgress('正在计算需要处理的照片数量...');
    let total = 0;
    let currentCount = 0;

    try {
      // 1. 预计算总数
      const studentRes = await apiFind('szproctec', {
        procedure: 'st_con_student_se_imgpath',
        i_idcampus: selectedCampus.ID,
        i_dtver: 0,
      });
      const teacherRes = await apiFind('szproctec', {
        procedure: 'st_con_teacher_se_imgpath',
        i_idcampus: selectedCampus.ID,
        i_dtver: 0,
      });

      const studentsToRegister = studentRes.data?.['#result-set-3'] || [];
      const teachersToRegister = teacherRes.data?.['#result-set-3'] || [];
      total = studentsToRegister.length + teachersToRegister.length;

      onProgressUpdate({
        total,
        current: 0,
        failed: failedCount,
        logs: [{ text: '正在计算需要处理的照片数量...', type: 'log' }],
        isComplete: false,
        isSuccess: false,
        elapsedTime: '',
      });

      if (total === 0) {
        await updateProgress('没有需要载入的照片。');
        return;
      }

      // 2. 清空当前校区的旧数据
      await updateProgress(`正在清空校区 "${selectedCampus.VCNAME}" 的旧数据...`);
      const usersToDelete = await getAllUsers();
      for (const user of usersToDelete) {
        await InspireFace.featureHubFaceRemove(user.id);
      }
      await deleteUsersByOrgId(String(selectedCampus.ID));
      await updateProgress(`已删除 ${usersToDelete.length} 条旧记录。`);

      // 3. 注册学生
      for (const student of studentsToRegister) {
        currentCount++;
        onProgressUpdate({
          total,
          current: currentCount,
          failed: failedCount,
          logs: [], // 日志由onProgress回调处理
          isComplete: false,
          isSuccess: false,
          elapsedTime: '',
        });

        const userName = `${student.VCNAME}`;
        await updateProgress(`处理中 (学生): ${userName}`);

        const feature = await this.extractFeatureFromUrlSession(
          student.VCIMGPATH,
          this.session,
          updateProgress
        );

        if (feature) {
          await updateProgress(`正在为 ${userName} 注册到人脸库...`);
          const faceId = await InspireFace.featureHubFaceInsert({
            id: -1,
            feature,
          });
          if (typeof faceId === 'number' && faceId !== -1) {
            await updateProgress(`注册成功，Face ID: ${faceId}，正在写入数据库...`, 'success');
            insertName(
              faceId,
              student.VCNAME,
              String(student.ID),
              student.VCNAME,
              "2", // role: student
              String(selectedCampus.ID),
              selectedCampus.VCNAME,
              student.VCIMGPATH
            );
          } else {
            await updateProgress(`${userName} 的人脸库插入失败`, 'error');
          }
        }
      }

      // 4. 注册教师
      for (const teacher of teachersToRegister) {
        currentCount++;
        onProgressUpdate({
          total,
          current: currentCount,
          failed: failedCount,
          logs: [], // 日志由onProgress回调处理
          isComplete: false,
          isSuccess: false,
          elapsedTime: '',
        });

        const userName = `${teacher.VCNAME}`;
        await updateProgress(`处理中 (老师): ${userName}`);

        const feature = await this.extractFeatureFromUrlSession(
          teacher.VCIMGPATH,
          this.session,
          updateProgress
        );

        if (feature) {
          await updateProgress(`正在为 ${userName} 注册到人脸库...`);
          const faceId = await InspireFace.featureHubFaceInsert({
            id: -1,
            feature,
          });
          if (typeof faceId === 'number' && faceId !== -1) {
            await updateProgress(`注册成功，Face ID: ${faceId}，正在写入数据库...`, 'success');
            insertName(
              faceId,
              teacher.VCNAME,
              String(teacher.ID),
              teacher.VCNAME,
              "1", // role: teacher
              String(selectedCampus.ID),
              selectedCampus.VCNAME,
              teacher.VCIMGPATH
            );
          } else {
            await updateProgress(`${userName} 的人脸库插入失败`, 'error');
          }
        }
      }

      await updateProgress('全部处理完成！', 'success');
      await updateProgress('', 'success');
    } catch (error) {
      const errMsg = (error as Error).message;
      await updateProgress(`发生严重错误: ${errMsg}`, 'error');
      console.error('重新载入照片失败:', errMsg);
    } finally {
      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;
      const elapsedTime = `耗时: ${duration.toFixed(2)} 秒`;

      onProgressUpdate({
        total,
        current: currentCount,
        failed: failedCount,
        logs: [],
        isComplete: true,
        isSuccess: wasSuccessful,
        elapsedTime,
      });
    }
  }
}
