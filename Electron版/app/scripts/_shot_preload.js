/**
 * UI 现代化 · 截图取证专用 preload
 * ------------------------------------------------------------
 * 目的：给 renderer 页面注入一个「够用」的 window.qhjf，让页面能完整渲染。
 *
 * 设计：
 *   - 明确实现的方法用真实数据（直连 data.db），保证截图里是真实内容与真实量级；
 *   - 其余一律走 Proxy 兜底返回结构化空值，避免逐个补方法；
 *   - 任何兜底命中都会打到 stdout，便于发现「哪些页面区域其实没渲染出来」。
 *
 * 注意：这是取证工具，不是应用运行时 —— 不参与打包（不落在 _pack_* 的白名单里）。
 */
'use strict';
const path = require('path');
const DB = require('../lib/db');

const USER = path.join(process.env.APPDATA || '', '岐黄鉴方·悬浮采集助手');
let dbOk = false;
try { DB.initDb(USER); dbOk = true; }
catch (e) { console.error('[shot] data.db 打开失败：' + e.message); }

const missed = new Set();

// —— 真实数据：记录列表 / 单条 ——
async function listRecords() { return dbOk ? DB.recList() : []; }
async function recGet(id) { return dbOk ? DB.recGet(id) : null; }

// —— 结构化空响应：只要页面读到的 key 不在 base 里，一律给 [] ——
// 后台/ Assist 页常写成 `r.xxx.filter(...)`，逐个补方法不现实；
// 给数组能让 .filter/.map/.length 全部成立，页面得以完整渲染而不是抛错中断。
function emptyBird() {
  const base = {
    ok: true, rows: [], items: [], list: [], total: 0, count: 0,
    text: '', enabled: false, error: '', name: '', version: '1.0.0',
  };
  return new Proxy(base, {
    get(t, k) { return k in t ? t[k] : []; },
    has() { return true; },
  });
}

const impl = {
  listRecords, recGet,
  patchRecord: async (_id, _p) => ({ ok: true }),
  removeRecord: async () => ({ ok: true }),
  seedDemo: async () => ({ ok: true }),
  clipboardWrite: async () => ({ ok: true }),
  exportRecordsTxt: async () => ({ ok: true, path: '' }),
  openPasteBox: () => {},
  photoOpen: () => {},
  panelStartRegion: async () => ({ ok: true }),
  // 顶栏用户名 / 版本
  sysGet: async () => ({
    ok: true, admin: true,
    app: { name: '岐黄鉴方 · 悬浮采集助手', version: '1.0.0' },
    user: { name: '演示药师', role: 'admin' },
    users: [{ name: '演示药师', role: 'admin' }],
    sys: {}, dept: '骨伤科',
  }),
  sysUsersList: async () => [{ name: '演示药师', role: 'admin' }],
  dataInfo: async () => ({
    ok: true, dir: USER, size: 0, records: (await listRecords()).length,
    dbSize: 0, kbCount: 0, refCount: 0,
  }),
  // 分析相关：返回未开启状态，页面会渲染对应的空态而非报错
  aiConfigGet: async () => ({ ok: true, enabled: false, provider: '', model: '', baseUrl: '', keySet: false }),
  ocrConfigGet: async () => ({ ok: true, tier: 'tiny', engine: 'paddle', langs: ['ch'] }),
  ocrStatus: async () => ({ ok: true, ready: true, tier: 'tiny', engine: 'paddle', envReady: true }),
  kbListAll: async () => [],
  kbStats: async () => ({ herbs: 0, formulas: 0 }),
};

// 以 on* 开头的是事件订阅：返回空函数即可（页面从不读返回值）
const handler = {
  get(_t, k) {
    if (typeof k !== 'string') return undefined;
    if (k in impl) return impl[k];
    if (k.startsWith('on')) return () => {};
    missed.add(k);
    return async () => emptyBird();
  },
  has() { return true; },
};

window.qhjf = new Proxy({}, handler);

// 页面读完 API 之后统一打印兜底清单，便于判断哪些区域其实是空的
setTimeout(() => {
  if (missed.size) console.log('[shot] 兜底 API：' + [...missed].sort().join(' '));
}, 1500);
