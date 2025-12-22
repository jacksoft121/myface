// src/db/FaceDB.ts
import { QuickSQLite } from 'react-native-quick-sqlite';
import { DLX_CONFIG } from './GlobalStorage';

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

const DB_NAME = DLX_CONFIG.USER_DB_PATH;
const TABLE = 'face_info';

let opened = false;

function ensureOpen() {
  if (!opened) {
    QuickSQLite.open(DB_NAME);
    opened = true;
  }
}

/**
 * 核心：同步运行 SQL 并提取数组
 */
function run(sql: string, params: any[] = []) {
  ensureOpen();
  const res = QuickSQLite.execute(DB_NAME, sql, params);
  const data = res?.rows?._array || [];
  return {
    ...res,
    data: data as any[],
  };
}

/**
 * 初始化：创建表（同步）
 */
export function initFaceDB() {
  run(
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
 * 诊断测试函数（同步）
 */
export function diagnosticTest() {
  console.log('Diagnostic: DB Name is', DB_NAME);
  const tableCheck = run("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [TABLE]);
  console.log('Diagnostic: Table exists?', JSON.stringify(tableCheck.data));
  const countCheck = run(`SELECT COUNT(*) as total FROM ${TABLE}`);
  console.log('Diagnostic: Total rows count:', JSON.stringify(countCheck.data));
  const rawData = run(`SELECT * FROM ${TABLE} LIMIT 1`);
  console.log('Diagnostic: Raw first row:', JSON.stringify(rawData.data));
}

function mapRowToUser(r: any): User {
  return {
    id: Number(r.id),
    name: String(r.name),
    dlx_user_id: r.dlx_user_id ? String(r.dlx_user_id) : undefined,
    dlx_user_name: r.dlx_user_name ? String(r.dlx_user_name) : undefined,
    dlx_user_role: r.dlx_user_role ? String(r.dlx_user_role) : undefined,
    dlx_user_org_id: r.dlx_user_org_id ? String(r.dlx_user_org_id) : undefined,
    dlx_user_org_name: r.dlx_user_org_name ? String(r.dlx_user_org_name) : undefined,
    dlx_user_oss_url: r.dlx_user_oss_url ? String(r.dlx_user_oss_url) : undefined,
  };
}

/**
 * 插入或更新（同步）
 */
export function insertName(
  id: number,
  name: string,
  dlxUserId?: string,
  dlxUserName?: string,
  dlxUserRole?: string,
  dlxUserOrgId?: string,
  dlxUserOrgName?: string,
  dlxUserOssUrl?: string
) {
  run(
    `INSERT OR REPLACE INTO ${TABLE}
    (id, name, dlx_user_id, dlx_user_name, dlx_user_role, dlx_user_org_id, dlx_user_org_name, dlx_user_oss_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, dlxUserId, dlxUserName, dlxUserRole, dlxUserOrgId, dlxUserOrgName, dlxUserOssUrl]
  );
}

export function updateDlxUserByFaceId(
  faceId: number,
  dlxUserId: string,
  dlxUserName: string,
  dlxUserRole: string,
  dlxUserOrgId: string,
  dlxUserOrgName: string,
  dlxUserOrgOssUrl: string
): number {
  const res = run(
    `UPDATE ${TABLE}
     SET dlx_user_id = ?, dlx_user_name = ?, dlx_user_role = ?, dlx_user_org_id = ?, dlx_user_org_name = ?, dlx_user_oss_url = ?
     WHERE id = ?`,
    [dlxUserId, dlxUserName, dlxUserRole, dlxUserOrgId, dlxUserOrgName, dlxUserOrgOssUrl, faceId]
  );
  return Number(res?.rowsAffected ?? 0);
}

/**
 * 根据 FaceID 查询用户（同步直接返回对象）
 */
export function queryUserByFaceId(faceId: number): User | null {
  const { data } = run(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [faceId]);
  return data.length > 0 ? mapRowToUser(data[0]) : null;
}

export function queryUsersByName(name: string): User[] {
  const { data } = run(`SELECT * FROM ${TABLE} WHERE name = ? ORDER BY id ASC`, [name]);
  return data.map(mapRowToUser);
}

export function queryUserByDlxUserId(dlxUserId: string): User | null {
  const { data } = run(`SELECT * FROM ${TABLE} WHERE dlx_user_id = ? LIMIT 1`, [dlxUserId]);
  return data.length > 0 ? mapRowToUser(data[0]) : null;
}

export function queryUsersByDlxUserRole(dlxUserRole: string): User[] {
  const { data } = run(`SELECT * FROM ${TABLE} WHERE dlx_user_role = ? ORDER BY id ASC`, [dlxUserRole]);
  return data.map(mapRowToUser);
}

export function queryUserByDlxInfo(dlxUserId: string, dlxUserRole: string): User | null {
  const { data } = run(`SELECT * FROM ${TABLE} WHERE dlx_user_id = ? AND dlx_user_role = ? LIMIT 1`, [dlxUserId, dlxUserRole]);
  return data.length > 0 ? mapRowToUser(data[0]) : null;
}

export function deleteByDlxInfo(dlxUserId: string, dlxUserRole: string): number {
  const res = run(`DELETE FROM ${TABLE} WHERE dlx_user_id = ? AND dlx_user_role = ?`, [dlxUserId, dlxUserRole]);
  return Number(res?.rowsAffected ?? 0);
}

export function deleteById(id: number): number {
  const res = run(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
  return Number(res?.rowsAffected ?? 0);
}

export function deleteByName(name: string): number {
  const res = run(`DELETE FROM ${TABLE} WHERE name = ?`, [name]);
  return Number(res?.rowsAffected ?? 0);
}

export function deleteAll(): number {
  const res = run(`DELETE FROM ${TABLE}`);
  return Number(res?.rowsAffected ?? 0);
}

export function getAllUsers(): User[] {
  const { data } = run(`SELECT * FROM ${TABLE} ORDER BY id ASC`);
  return data.map(mapRowToUser);
}

export function updateName(id: number, newName: string): number {
  const res = run(`UPDATE ${TABLE} SET name = ? WHERE id = ?`, [newName, id]);
  return Number(res?.rowsAffected ?? 0);
}

export function queryUsersByOrgId(orgId: string): User[] {
  const { data } = run(`SELECT * FROM ${TABLE} WHERE dlx_user_org_id = ?`, [orgId]);
  return data.map(mapRowToUser);
}

export function deleteUsersByOrgId(orgId: string): number {
  const res = run(`DELETE FROM ${TABLE} WHERE dlx_user_org_id = ?`, [orgId]);
  return Number(res?.rowsAffected ?? 0);
}

export function debugGetAllRawData(): any[] {
  const { data } = run(`SELECT * FROM ${TABLE}`);
  return data;
}

export function closeFaceDB() {
  if (opened) {
    QuickSQLite.close(DB_NAME);
    opened = false;
  }
}
