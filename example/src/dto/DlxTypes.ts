
/**
 * 注册人脸数据 来自kkvm的registeredFaces
 */
export type RegisteredFacesDTO = {
  id: number; // 对应业务的id 例如：学生id或老师id
  faceId:number;// 人脸特征id
  name: string; //姓名
  role: string; // 角色 1=老师 2=学生
  timestamp?: number ;  //注册时间戳
  imageUri?: string;   //注册的原始图片URI
  imageUrl?: string;   //注册的原始图片oss地址
};



export type FaceBoxUI = {
  x: number;
  y: number;
  width: number;
  height: number;
  id: number; // 这里用 trackId，当作识别 id（你可替换成 personId）
  name?: string; //姓名
  confidence?: number; // 添加置信度字段
  isMatched?: boolean; // 添加匹配状态字段
};

export type FaceBoxBuf = {
  x: number;
  y: number;
  width: number;
  height: number;
  trackId: number;
  confidence?: number;
  isMatched?: boolean;
};
