// src/db/FaceDB.ts
import {QuickSQLite} from 'react-native-quick-sqlite';

export type User = {
  id: number;
  name: string;
  dlx_user_id?: string;
  dlx_user_name?: string;
  dlx_user_role?: string;
  dlx_user_org_id?: string;
  dlx_user_org_name?: string;
  dlx_user_oss_url?: string;
};
import {DLX_CONFIG} from './GlobalStorage';

const DB_NAME = DLX_CONFIG.INSPIREFACE_DB_PATH;
const TABLE = 'face_info';

let opened = false;

function ensureOpen() {
  if (!opened) {
    QuickSQLite.open(DB_NAME);
    opened = true;
  }
}

function run(sql: string, params: any[] = []) {
  ensureOpen();
  return QuickSQLite.execute(DB_NAME, sql, params);
}

/**
 * 初始化：创建表（如果不存在）
 */
export async function initFaceDB() {
  await run(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY,
      name TEXT,
      dlx_user_id TEXT,
      dlx_user_name TEXT,
      dlx_user_role TEXT,
      dlx_user_org_id TEXT,
      dlx_user_org_name TEXT,
      dlx_user_oss_url TEXT
     )`
  );
}


/**
 * 向已存在的表中增加新字段（用于旧版本升级）
 */
export async function alterTableToAddNewColumns() {
  // 添加 dlx_user_id 字段
  try {
    await run(`ALTER TABLE ${TABLE}
      ADD COLUMN dlx_user_id TEXT`);
  } catch (e) {
    // 字段可能已存在，忽略错误
  }

  // 添加 dlx_user_name 字段
  try {
    await run(`ALTER TABLE ${TABLE}
      ADD COLUMN dlx_user_name TEXT`);
  } catch (e) {
    // 字段可能已存在，忽略错误
  }

  // 添加 dlx_user_role 字段
  try {
    await run(`ALTER TABLE ${TABLE}
      ADD COLUMN dlx_user_role TEXT`);
  } catch (e) {
    // 字段可能已存在，忽略错误
  }

  // 添加 dlx_user_org_id 字段
  try {
    await run(`ALTER TABLE ${TABLE}
      ADD COLUMN dlx_user_org_id TEXT`);
  } catch (e) {
    // 字段可能已存在，忽略错误
  }

  // 添加 dlx_user_org_name 字段
  try {
    await run(`ALTER TABLE ${TABLE}
      ADD COLUMN dlx_user_org_name TEXT`);
  } catch (e) {
    // 字段可能已存在，忽略错误
  }
  // 添加 dlx_user_org_oss_url 字段
  try {
    await run(`ALTER TABLE ${TABLE}
      ADD COLUMN dlx_user_oss_url TEXT`);
  } catch (e) {
    // 字段可能已存在，忽略错误
  }
}

/**
 * upsert：插入或更新（等价 insertWithOnConflict(REPLACE)）
 */
export async function insertName(
  id: number,
  name: string,
  dlxUserId?: string,
  dlxUserName?: string,
  dlxUserRole?: string,
  dlxUserOrgId?: string,
  dlxUserOrgName?: string
  , dlxUserOrgOssUrl?: string
) {
  // SQLite 的 REPLACE 会先删再插（会改变 rowid 行为，但你这里主键就是 id，没问题）
  await run(
    `INSERT
    OR REPLACE INTO
    ${TABLE}
    (
    id,
    name,
    dlx_user_id,
    dlx_user_name,
    dlx_user_role,
    dlx_user_org_id,
    dlx_user_org_name,
    dlx_user_oss_url
    )
    VALUES
    (
    ?,
    ?,
    ?,
    ?,
    ?,
    ?,
    ?,
    ?
    )`,
    [id, name, dlxUserId, dlxUserName, dlxUserRole, dlxUserOrgId, dlxUserOrgName, dlxUserOrgOssUrl]
  );
}

/**
 * 根据 faceId 更新用户信息
 */
export async function updateDlxUserByFaceId(
  faceId: number,
  dlxUserId: string,
  dlxUserName: string,
  dlxUserRole: string,
  dlxUserOrgId: string,
  dlxUserOrgName: string,
  dlxUserOrgOssUrl: string
): Promise<number> {
  const res = await run(
    `UPDATE ${TABLE}
     SET dlx_user_id       = ?,
         dlx_user_name     = ?,
         dlx_user_role     = ?,
         dlx_user_org_id   = ?,
         dlx_user_org_name = ?,
         dlx_user_oss_url  = ?
     WHERE id = ?`,
    [dlxUserId, dlxUserName, dlxUserRole, dlxUserOrgId, dlxUserOrgName, dlxUserOrgOssUrl, faceId]
  );
  return Number(res?.rowsAffected ?? 0);
}


/**
 * 根据 dlx_user_id 和 dlx_user_role 更新数据
 */
export async function updateByDlxUserInfo(
  dlxUserId: string,
  dlxUserRole: string,
  name?: string,
  dlxUserName?: string,
  dlxUserOrgId?: string,
  dlxUserOrgName?: string
): Promise<number> {
  const res = await run(
    `UPDATE ${TABLE}
     SET name              = COALESCE(?, name),
         dlx_user_name     = COALESCE(?, dlx_user_name),
         dlx_user_org_id   = COALESCE(?, dlx_user_org_id),
         dlx_user_org_name = COALESCE(?, dlx_user_org_name)
     WHERE dlx_user_id = ?
       AND dlx_user_role = ?`,
    [name, dlxUserName, dlxUserOrgId, dlxUserOrgName, dlxUserId, dlxUserRole]
  );
  return Number(res?.rowsAffected ?? 0);
}

/**
 * 根据 id 查 name
 */
export async function queryNameById(id: number): Promise<string | null> {
  const res = await run(`SELECT name
                         FROM ${TABLE}
                         WHERE id = ? LIMIT 1`, [id]);
  const rows = res?.rows ?? [];
  if (!rows.length) return null;
  return rows[0]?.name ?? null;
}

/**
 * 根据 name 查全部用户（等价 queryNameByName）
 */
export async function queryUsersByName(name: string): Promise<User[]> {
  const res = await run(
    `SELECT id,
            name,
            dlx_user_id,
            dlx_user_name,
            dlx_user_role,
            dlx_user_org_id,
            dlx_user_org_name,
            dlx_user_oss_url
     FROM ${TABLE}
     WHERE name = ?
     ORDER BY id ASC`,
    [name]
  );
  const rows = res?.rows ?? [];
  return rows.map((r: any) => ({
    id: Number(r.id),
    name: String(r.name),
    dlx_user_id: r.dlx_user_id ? String(r.dlx_user_id) : undefined,
    dlx_user_name: r.dlx_user_name ? String(r.dlx_user_name) : undefined,
    dlx_user_role: r.dlx_user_role ? String(r.dlx_user_role) : undefined,
    dlx_user_org_id: r.dlx_user_org_id ? String(r.dlx_user_org_id) : undefined,
    dlx_user_org_name: r.dlx_user_org_name ? String(r.dlx_user_org_name) : undefined,
    dlx_user_oss_url: r.dlx_user_oss_url ? String(r.dlx_user_oss_url) : undefined
  }));
}

/**
 * 根据 dlx_user_id 查询用户信息
 */
export async function queryUserByDlxUserId(dlxUserId: string): Promise<User | null> {
  const res = await run(
    `SELECT id,
            name,
            dlx_user_id,
            dlx_user_name,
            dlx_user_role,
            dlx_user_org_id,
            dlx_user_org_name,
            dlx_user_oss_url
     FROM ${TABLE}
     WHERE dlx_user_id = ? LIMIT 1`,
    [dlxUserId]
  );
  const rows = res?.rows ?? [];
  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: Number(row.id),
    name: String(row.name),
    dlx_user_id: row.dlx_user_id ? String(row.dlx_user_id) : undefined,
    dlx_user_name: row.dlx_user_name ? String(row.dlx_user_name) : undefined,
    dlx_user_role: row.dlx_user_role ? String(row.dlx_user_role) : undefined,
    dlx_user_org_id: row.dlx_user_org_id ? String(row.dlx_user_org_id) : undefined,
    dlx_user_org_name: row.dlx_user_org_name ? String(row.dlx_user_org_name) : undefined,
    dlx_user_oss_url: row.dlx_user_oss_url ? String(row.dlx_user_oss_url) : undefined
  };
}

/**
 * 根据 dlx_user_role 查询用户列表
 */
export async function queryUsersByDlxUserRole(dlxUserRole: string): Promise<User[]> {
  const res = await run(
    `SELECT id,
            name,
            dlx_user_id,
            dlx_user_name,
            dlx_user_role,
            dlx_user_org_id,
            dlx_user_org_name,
            dlx_user_oss_url
     FROM ${TABLE}
     WHERE dlx_user_role = ?
     ORDER BY id ASC`,
    [dlxUserRole]
  );
  const rows = res?.rows ?? [];
  return rows.map((r: any) => ({
    id: Number(r.id),
    name: String(r.name),
    dlx_user_id: r.dlx_user_id ? String(r.dlx_user_id) : undefined,
    dlx_user_name: r.dlx_user_name ? String(r.dlx_user_name) : undefined,
    dlx_user_role: r.dlx_user_role ? String(r.dlx_user_role) : undefined,
    dlx_user_org_id: r.dlx_user_org_id ? String(r.dlx_user_org_id) : undefined,
    dlx_user_org_name: r.dlx_user_org_name ? String(r.dlx_user_org_name) : undefined,
    dlx_user_oss_url: r.dlx_user_oss_url ? String(r.dlx_user_oss_url) : undefined
  }));
}

/**
 * 根据 dlx_user_id 和 dlx_user_role 查询一条数据
 */
export async function queryUserByDlxInfo(dlxUserId: string, dlxUserRole: string): Promise<User | null> {
  const res = await run(
    `SELECT id,
            name,
            dlx_user_id,
            dlx_user_name,
            dlx_user_role,
            dlx_user_org_id,
            dlx_user_org_name,
            dlx_user_oss_url
     FROM ${TABLE}
     WHERE dlx_user_id = ?
       AND dlx_user_role = ? LIMIT 1`,
    [dlxUserId, dlxUserRole]
  );
  const rows = res?.rows ?? [];
  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: Number(row.id),
    name: String(row.name),
    dlx_user_id: row.dlx_user_id ? String(row.dlx_user_id) : undefined,
    dlx_user_name: row.dlx_user_name ? String(row.dlx_user_name) : undefined,
    dlx_user_role: row.dlx_user_role ? String(row.dlx_user_role) : undefined,
    dlx_user_org_id: row.dlx_user_org_id ? String(row.dlx_user_org_id) : undefined,
    dlx_user_org_name: row.dlx_user_org_name ? String(row.dlx_user_org_name) : undefined
    , dlx_user_oss_url: row.dlx_user_oss_url ? String(row.dlx_user_oss_url) : undefined
  };
}

/**
 * 根据 dlx_user_id 和 dlx_user_role 删除数据
 */
export async function deleteByDlxInfo(dlxUserId: string, dlxUserRole: string): Promise<number> {
  const res = await run(
    `DELETE
     FROM ${TABLE}
     WHERE dlx_user_id = ?
       AND dlx_user_role = ?`,
    [dlxUserId, dlxUserRole]
  );
  return Number(res?.rowsAffected ?? 0);
}

/**
 * 根据 id 删除
 */
export async function deleteById(id: number): Promise<number> {
  const res = await run(`DELETE
                         FROM ${TABLE}
                         WHERE id = ?`, [id]);
  // quick-sqlite 返回里一般有 rowsAffected（不同版本字段名可能略有差异）
  return Number(res?.rowsAffected ?? 0);
}

/**
 * 根据 name 删除
 */
export async function deleteByName(name: string): Promise<number> {
  const res = await run(`DELETE
                         FROM ${TABLE}
                         WHERE name = ?`, [name]);
  return Number(res?.rowsAffected ?? 0);
}

/**
 * 删除所有记录
 */
export async function deleteAll(): Promise<number> {
  const res = await run(`DELETE
                         FROM ${TABLE}`);
  return Number(res?.rowsAffected ?? 0);
}

/**
 * 获取所有用户（等价 getAllUsers）
 */
export async function getAllUsers(): Promise<User[]> {
  const res = await run(
    `SELECT id,
            name,
            dlx_user_id,
            dlx_user_name,
            dlx_user_role,
            dlx_user_org_id,
            dlx_user_org_name,
            dlx_user_oss_url
     FROM ${TABLE}
     ORDER BY id ASC`
  );
  const rows = res?.rows ?? [];
  return rows.map((r: any) => ({
    id: Number(r.id),
    name: String(r.name),
    dlx_user_id: r.dlx_user_id ? String(r.dlx_user_id) : undefined,
    dlx_user_name: r.dlx_user_name ? String(r.dlx_user_name) : undefined,
    dlx_user_role: r.dlx_user_role ? String(r.dlx_user_role) : undefined,
    dlx_user_org_id: r.dlx_user_org_id ? String(r.dlx_user_org_id) : undefined,
    dlx_user_org_name: r.dlx_user_org_name ? String(r.dlx_user_org_name) : undefined
    , dlx_user_oss_url: r.dlx_user_oss_url ? String(r.dlx_user_oss_url) : undefined
  }));
}

/**
 * 根据 id 修改名称（等价 updateName）
 */
export async function updateName(id: number, newName: string): Promise<number> {
  const res = await run(`UPDATE ${TABLE}
                         SET name = ?
                         WHERE id = ?`, [newName, id]);
  return Number(res?.rowsAffected ?? 0);
}

/**
 * 根据校区ID (dlx_user_org_id) 查询用户
 */
export async function queryUsersByOrgId(orgId: string): Promise<User[]> {
  const res = await run(
    `SELECT id, name, dlx_user_id, dlx_user_name, dlx_user_role, dlx_user_org_id, dlx_user_org_name, dlx_user_oss_url
     FROM ${TABLE}
     WHERE dlx_user_org_id = ?`,
    [orgId]
  );
  const rows = res?.rows ?? [];
  return rows.map((r: any) => ({
    id: Number(r.id),
    name: String(r.name),
    dlx_user_id: r.dlx_user_id ? String(r.dlx_user_id) : undefined,
    dlx_user_name: r.dlx_user_name ? String(r.dlx_user_name) : undefined,
    dlx_user_role: r.dlx_user_role ? String(r.dlx_user_role) : undefined,
    dlx_user_org_id: r.dlx_user_org_id ? String(r.dlx_user_org_id) : undefined,
    dlx_user_org_name: r.dlx_user_org_name ? String(r.dlx_user_org_name) : undefined,
    dlx_user_oss_url: r.dlx_user_oss_url ? String(r.dlx_user_oss_url) : undefined,
  }));
}


/**
 * 根据校区ID (dlx_user_org_id) 删除用户
 */
export async function deleteUsersByOrgId(orgId: string): Promise<number> {
  const res = await run(
    `DELETE FROM ${TABLE} WHERE dlx_user_org_id = ?`,
    [orgId]
  );
  return Number(res?.rowsAffected ?? 0);
}


/**
 * 可选：关闭数据库（一般 App 不需要频繁 close）
 */
export async function closeFaceDB() {
  if (opened) {
    QuickSQLite.close(DB_NAME);
    opened = false;
  }
}
