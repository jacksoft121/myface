import { STORAGE_KEYS, recognitionStorage} from './GlobalStorage';

const CURRENT_USER_KEY = STORAGE_KEYS.CURRENT_USER;


export type User = {
  ID: string;
  VCNAME: string; // 用户名称
  campusId?: number; // 用户默认校区ID
  campusName?: string; // 用户默认校区名称
  IDCLASSSCOPE?: string; // 新增：班级范围ID
  DTLASTCHANGEPWD?: string; // 新增：上次修改密码时间

  // 以下是根据登录接口返回补充的字段
  IDORG?: string;
  VCPHONE?: string;
  VCNAMECUST?: string;
  VCPATH?: string;
  VCPATH2?: string;
  VCPATH3?: string;
  VCPATHAI?: string;
  VCPATHAIQSX?: string;
  VCPATHAIPDF?: string;
  VCPATHAIPDF2?: string;
  VCUPREGION?: string;
  VCUPBUCKET?: string;
  VCUPURL?: string;
  VCFUNCTION?: string;
  VCURLUPFACE?: string;
  VCUPACCESSKEYID?: string;
  VCUPACCESSKEYSECRET?: string;
  QIDISCOUNT?: string;
  VCCODE?: string;
  VCFUNSON?: string;
  VCFUNWRONG?: string;
  VCDISCOUNT?: string;
  IDAPP?: string;
  ISPUBLISH?: string | null;
  VCTEXT?: string;
  IDVERUT?: string | null;
  VCAPPVERSIONIOS?: string;
  VCUPAPPURLIOS?: string;
  ISAPPTYPEIOS?: string;
  VCAPPVERSION?: string;
  VCUPAPPURL?: string;
  ISAPPTYPE?: string;
  ISSILENTLY?: string;
  ISMANDATORY?: string;
  VCCODESMS?: string;
  QIQUANTITY_WRONGIMG?: string;
  QIWIDTH_WRONGIMG?: string;
  VCPATTERNLM?: string;
  VCPATTERNCN?: string;
  VCPATTERNKH?: string;
  VCPATTERNNUM?: string;
  VCPATTERNQUESTION?: string;
  VCPATTERWRONG?: string;
  ISBF?: string;
  o_msg?: string;
  o_info?: string;
  o_errid?: string;
  IDCAMPUS ?: string;//字段通常会映射到 campusId (number)，此处保留原样作为参考，实际使用时需要转换
  IDROLE?: string;
  ISGLOBLE?: string;
  VCNAMEROLE?: string;
  DTTOKEN?: string;
  ISBW?: string;
  ISAUTOCHAT?: string;
  QIFACESCORE?: string;
  VCLOGOURL?: string;
  VCSKMURL?: string | null;
  QIWRONG?: string | null;
  QIAICUR?: string | null;
  VCWRONGPERIOD?: string | null;
  ISCWSR?: string;
  ISCWZC?: string;
  DTQDTIME?: string;
  DTQTTIME?: string;
  ISQDZP?: string;
  ISQDDW?: string;
  ISQDTC?: string;
  ISQDTCT?: string;
  DTQDTIME1?: string;
  DTQTTIME1?: string;
  token?: string;
  urlfind?: string;
  urlpost?: string;
};
export const setCurrentUser = (user: User) => {
  try {
    recognitionStorage.set(CURRENT_USER_KEY, JSON.stringify(user));
  } catch (e) {
    console.error('Failed to set current user to storage:', e);
  }
};

export const getCurrentUser = (): User | null => {
  try {
    const userJson = recognitionStorage.getString(CURRENT_USER_KEY);
    if (userJson) {
      return JSON.parse(userJson) as User;
    }
    return null;
  } catch (error) {
    console.error('Failed to retrieve user data:', error);
    return null;
  }
};

// 如果还有其他使用存储的方法，也需要相应更新
