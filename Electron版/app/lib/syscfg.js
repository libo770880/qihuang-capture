// lib/syscfg.js - 基础信息维护：软件名称 / 登录模式 / 账号密码 / 人员科室 / 数据备份 / 日志
// 配置存于 SQLite data.db 的 kv 表（k='syscfg'；db.migrateJson 首启已从旧 syscfg.json 迁入）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DB = require('./db');

let userDataDir = null;
let cfgFile = null;
let log = () => {};
let FRONT_DEPT = '';   // 当前前台登录用户科室（采集记录兜底归属）

const CFG = {
  appName: '',            // 软件名称（空 = 默认「岐黄鉴方」）
  loginMode: 'none',      // none=免登录 | password=账号密码登录
  adminUrl: '',           // 后台链接地址（内网分离部署时前台跳转用，空=本机后台）
  admin: null,            // { user, salt, hash } 后台管理账号（null=未设置，后台免登录）
  users: [],              // [{ user, salt, hash, name, dept, role:'front'|'admin', enabled }]
  depts: [],              // 科室列表
  backups: []             // [{ dir, time, files, bytes }]
};

function sha(salt, pass) {
  return crypto.createHash('sha256').update(salt + '|' + String(pass)).digest('hex');
}
function newSalt() { return crypto.randomBytes(8).toString('hex'); }

function load() {
  const raw = DB.kvGet('syscfg');
  if (!raw || typeof raw !== 'object') return; // 首次运行无配置
  CFG.appName = String(raw.appName || '');
  CFG.loginMode = raw.loginMode === 'password' ? 'password' : 'none';
  CFG.adminUrl = typeof raw.adminUrl === 'string' ? raw.adminUrl : '';
  CFG.admin = raw.admin && raw.admin.user && raw.admin.hash ? raw.admin : null;
  CFG.users = Array.isArray(raw.users) ? raw.users.filter(u => u && u.user && u.hash) : [];
  CFG.depts = Array.isArray(raw.depts) ? raw.depts.map(String) : [];
  CFG.backups = Array.isArray(raw.backups) ? raw.backups : [];
}
function save() {
  DB.kvSet('syscfg', CFG);
}

function mask(u) {
  // 对外输出时剔除哈希字段
  const { salt, hash, ...rest } = u;
  return rest;
}

function initSysCfg(dir, logFn) {
  userDataDir = dir;
  cfgFile = path.join(dir, 'syscfg.json');
  if (typeof logFn === 'function') log = logFn;
  load();
  log('syscfg', 'loaded users=' + CFG.users.length + ' mode=' + CFG.loginMode + ' admin=' + (CFG.admin ? 'set' : 'none'));
  return module.exports;
}

// ---------- 基础信息 ----------
function getPublic() {
  return {
    appName: CFG.appName || '岐黄鉴方',
    loginMode: CFG.loginMode,
    adminUrl: CFG.adminUrl || '',
    hasAdmin: !!CFG.admin,
    adminUser: CFG.admin ? CFG.admin.user : '',
    depts: CFG.depts.slice(),
    users: CFG.users.map(mask),
    backups: CFG.backups.slice(0, 20),
    dataDir: userDataDir,
    logsDir: path.join(userDataDir, 'logs')
  };
}
function setApp({ appName, loginMode, adminUrl } = {}) {
  if (typeof appName === 'string') CFG.appName = appName.trim().slice(0, 30);
  if (typeof adminUrl === 'string') {
    const u = adminUrl.trim();
    if (u && !/^https?:\/\//i.test(u)) return { ok: false, error: '后台地址需以 http:// 或 https:// 开头' };
    CFG.adminUrl = u.slice(0, 200);
  }
  if (loginMode === 'password' || loginMode === 'none') {
    // 开启前台密码登录时，至少要有一个启用账号，否则提示拒绝
    if (loginMode === 'password' && !CFG.users.some(u => u.enabled !== false)) {
      return { ok: false, error: '请先在「人员科室维护」中创建至少一个启用状态的前台账号' };
    }
    CFG.loginMode = loginMode;
  }
  save();
  log('syscfg', 'setApp mode=' + CFG.loginMode + ' name=' + (CFG.appName || '(默认)'));
  return { ok: true, ...getPublic() };
}

// ---------- 后台管理账号 ----------
function setAdminAccount({ user, pass, oldPass } = {}) {
  const u = String(user || '').trim();
  if (!u) return { ok: false, error: '账号不能为空' };
  if (CFG.admin) {
    // 已有账号：需验证旧密码（防误改）
    if (!oldPass || sha(CFG.admin.salt, oldPass) !== CFG.admin.hash) {
      return { ok: false, error: '旧密码不正确，无法修改管理账号' };
    }
  }
  const p = String(pass || '');
  if (p.length < 4) return { ok: false, error: '密码至少 4 位' };
  const salt = newSalt();
  CFG.admin = { user: u, salt, hash: sha(salt, p) };
  save();
  log('syscfg', 'admin account set user=' + u);
  return { ok: true };
}

// 解除后台登录：验证当前管理密码后清除管理账号（后台登录门随 hasAdmin 消失）
function clearAdminAccount({ oldPass } = {}) {
  if (!CFG.admin) return { ok: true, skip: true };
  if (!oldPass || sha(CFG.admin.salt, oldPass) !== CFG.admin.hash) {
    return { ok: false, error: '当前管理密码不正确，无法解除后台登录' };
  }
  CFG.admin = null;
  save();
  log('syscfg', 'admin account cleared');
  return { ok: true };
}

// ---------- 人员科室 ----------
function setDepts(list) {
  const arr = (Array.isArray(list) ? list : String(list || '').split(/[,，、\n]+/))
    .map(s => String(s).trim()).filter(Boolean);
  CFG.depts = [...new Set(arr)].slice(0, 200);
  save();
  return { ok: true, depts: CFG.depts };
}
function listUsers() { return { ok: true, users: CFG.users.map(mask), depts: CFG.depts.slice() }; }
function upsertUser({ user, name, dept, role, enabled, pass } = {}) {
  const un = String(user || '').trim();
  if (!un) return { ok: false, error: '账号不能为空' };
  let u = CFG.users.find(x => x.user === un);
  if (!u) {
    const p = String(pass || '');
    if (p.length < 4) return { ok: false, error: '新账号需设置至少 4 位密码' };
    const salt = newSalt();
    u = { user: un, salt, hash: sha(salt, p) };
    CFG.users.push(u);
  } else if (pass) {
    const p = String(pass);
    if (p && p.length < 4) return { ok: false, error: '密码至少 4 位' };
    if (p) { u.salt = newSalt(); u.hash = sha(u.salt, p); }
  }
  if (typeof name === 'string') u.name = name.trim().slice(0, 20);
  if (typeof dept === 'string') u.dept = dept.trim().slice(0, 30);
  if (role === 'front' || role === 'admin') u.role = role;
  if (enabled === false || enabled === true) u.enabled = enabled;
  if (u.enabled === undefined) u.enabled = true;
  save();
  log('syscfg', 'user upsert ' + un);
  return { ok: true };
}
function removeUser(user) {
  const before = CFG.users.length;
  CFG.users = CFG.users.filter(u => u.user !== user);
  save();
  return { ok: CFG.users.length < before };
}

// ---------- 登录校验（scope: 'front' 前台 | 'admin' 后台） ----------
function verifyLogin(scope, user, pass) {
  const un = String(user || '').trim();
  if (scope === 'admin') {
    if (!CFG.admin) return { ok: true, skip: true }; // 未设置管理账号 = 后台免登录
    if (un !== CFG.admin.user || sha(CFG.admin.salt, pass) !== CFG.admin.hash) {
      log('syscfg', 'admin login FAIL user=' + un);
      return { ok: false, error: '账号或密码不正确' };
    }
    log('syscfg', 'admin login ok');
    return { ok: true, user: { user: un, name: '管理员', role: 'admin' } };
  }
  // 前台：账号密码模式下校验 users 表；免登录模式直接放行
  if (CFG.loginMode !== 'password') return { ok: true, skip: true };
  const u = CFG.users.find(x => x.user === un);
  if (!u || u.enabled === false || sha(u.salt, String(pass || '')) !== u.hash) {
    log('syscfg', 'front login FAIL user=' + un);
    return { ok: false, error: '账号或密码不正确，或账号已停用' };
  }
  log('syscfg', 'front login ok user=' + un);
  FRONT_DEPT = String(u.dept || '').trim().slice(0, 20);   // 之后采集的记录默认归属该科室（文本里识别到科室则优先）
  return { ok: true, user: { user: un, name: u.name || un, dept: u.dept || '', role: u.role || 'front' } };
}
/** 当前前台登录用户的科室（未登录/免登录为空串）。finalizeRecord 用作科室兜底。 */
function frontDept() { return FRONT_DEPT; }

// ---------- 数据备份 ----------
function backup(targetDir) {
  const ts = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const dest = path.join(String(targetDir || path.join(userDataDir, 'backups')), `岐黄鉴方备份_${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  // 备份范围：记录（截图）/ 知识库 / SQLite 数据库 / 配置文件
  const dirs = ['records', 'knowledge', 'clinical', 'backups_cfg'];
  try { DB.checkpoint(); } catch (e) { /* checkpoint 失败不阻断 */ }
  const files = ['data.db', 'ocr.json', 'ai.json', 'syscfg.json', 'tcm-westmap.json'];
  let count = 0, bytes = 0;
  for (const d of ['records', 'knowledge']) {
    const src = path.join(userDataDir, d);
    if (fs.existsSync(src)) { fs.cpSync(src, path.join(dest, d), { recursive: true }); count++; }
  }
  for (const f of files) {
    const src = path.join(userDataDir, f);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dest, f)); count++; bytes += fs.statSync(src).size; }
  }
  const info = { dir: dest, time: ts.toLocaleString('zh-CN'), files: count, bytes };
  CFG.backups.unshift(info);
  CFG.backups = CFG.backups.slice(0, 50);
  save();
  log('syscfg', 'backup → ' + dest + ' items=' + count);
  return { ok: true, ...info };
}

// ---------- 日志 ----------
function readLog(maxLines) {
  const f = path.join(userDataDir, 'logs', 'app.log');
  try {
    const raw = fs.readFileSync(f, 'utf8').split('\n');
    const lines = raw.slice(-Math.max(50, Number(maxLines) || 200));
    return { ok: true, lines, total: raw.length, file: f };
  } catch (e) { return { ok: true, lines: ['（暂无日志）'], total: 0, file: f }; }
}

module.exports = {
  initSysCfg, getPublic, setApp, setAdminAccount, clearAdminAccount,
  setDepts, listUsers, upsertUser, removeUser,
  verifyLogin, frontDept, backup, readLog
};
