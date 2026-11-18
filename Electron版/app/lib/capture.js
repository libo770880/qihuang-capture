// lib/capture.js - 采集服务：前台窗口定位 / 截图 / OCR / UIA
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runPs } = require('./ps');
const { runPy, findPython, PyServer } = require('./py');
const tess = require('./tess');

const TMP_DIR = path.join(os.tmpdir(), 'qhjf-capture');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

let _seq = 0;
function tmpImage(prefix = 'shot') {
  _seq += 1;
  return path.join(TMP_DIR, `${prefix}_${Date.now()}_${_seq}.png`);
}

/** 读取前台窗口信息（标题/进程/矩形） */
async function getForegroundWindow() {
  const r = await runPs('fgwindow.ps1', {}, 15000);
  return r;
}

/**
 * 截图指定物理像素区域
 * @returns {Promise<string>} png 路径
 */
async function captureRegion({ x, y, w, h }) {
  const safe = { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  const out = tmpImage('win');
  const r = await runPs('capture-region.ps1', { ...safe, Out: out }, 30000);
  if (!r.path || !fs.existsSync(r.path)) throw new Error('capture produced no file');
  return r.path;
}

/** OCR 引擎配置（主进程启动时注入）：
 *  engine=auto|paddle|rapid|win|tess；tier=PP-OCRv6 档位；python=自定义解释器
 *  rapid = RapidOCR(ONNX) 通道（主动选用：内存占用更低、任何 x64 CPU 可用）
 *  tier 默认 tiny：实测两张真实 HIS 图上 tiny 与 medium 术语命中完全一致，而推理快约 10 倍
 *  （处方图 20.0s→1.8s，全屏 211.6s→20.0s），低配机差距更大。 */
let OCR_CFG = { engine: 'auto', tier: 'tiny', python: '' };
/** 环境探针缓存：一次冷探针要 ~12 秒（起 Python + import paddleocr），而后台「OCR 引擎」页
 *  每次开页/保存都会问一次状态 —— 必须缓存 + 并发去重，否则每次点开页签都要等满一次冷启动。
 *  常驻服务已在跑时改走它（引擎已在内存），实测 5.7s → 3ms。声明在此（早于 setOcrConfig
 *  的调用点），避免启动期配置写入触发 TDZ。 */
let _ocrProbeCache = null;   // { at, data }
let _ocrProbeInflight = null;
const OCR_PROBE_TTL = 5 * 60 * 1000;

function setOcrConfig(cfg) {
  const patch = cfg || {};
  const pyBefore = OCR_CFG.python;
  OCR_CFG = Object.assign({}, OCR_CFG, patch);
  // 只有 Python 路径会改变环境结论（引擎/档位不影响通道可用性）→ 仅此时作废缓存，
  // 这样后台「保存设置」不必再等一次探针。
  if ('python' in patch && patch.python !== pyBefore) { _ocrProbeCache = null; _ocrProbeInflight = null; }
  return { ...OCR_CFG };
}
function ocrConfig() { return { ...OCR_CFG }; }

/** 引擎模式 → ocr_paddle.py 的 --force 通道。
 *  注意 rapid 走强制；paddle/auto 仍传 auto（原生优先、无 AVX 时静默回落 ONNX），
 *  保持既有配置的行为零漂移。 */
function forceOf(mode) { return mode === 'rapid' ? 'rapid' : 'auto'; }

/** 该模式下是否使用 Python OCR 通道 */
function usesPython(mode) { return mode === 'auto' || mode === 'paddle' || mode === 'rapid'; }

/** PaddleOCR（PP-OCRv6）/ RapidOCR(ONNX) 通道：常驻服务（模型只加载一次），失败自动回落单次调用 */
let _paddleSrv = null;
let _paddleSrvKey = '';
function paddleServer(force) {
  const key = (OCR_CFG.tier || 'medium') + '|' + (OCR_CFG.python || '') + '|' + force;
  if (_paddleSrv && _paddleSrvKey === key) return _paddleSrv;
  if (_paddleSrv) { try { _paddleSrv.stop(); } catch (e) { /* 忽略 */ } }
  _paddleSrvKey = key;
  _paddleSrv = new PyServer('ocr_paddle.py', { serve: true, tier: OCR_CFG.tier || 'medium', lang: 'ch', force }, OCR_CFG.python);
  return _paddleSrv;
}
async function ocrPaddle(imagePath, force = 'auto') {
  let r = null;
  try {
    r = await paddleServer(force).request({ image: imagePath });
  } catch (e) {
    _paddleSrv = null; // 服务异常 → 下次重建
    r = null;
  }
  if (!r || !r.ok) {
    // 常驻服务不可用 → 退回单次调用（慢但可用）
    r = await runPy('ocr_paddle.py', {
      image: imagePath,
      tier: OCR_CFG.tier || 'medium',
      lang: 'ch',
      force
    }, 240000, OCR_CFG.python);
  }
  if (!r || !r.ok) throw new Error((r && r.error) || 'ocr failed');
  return r;
}

/** Windows 内置 OCR 通道：零依赖兜底 */
async function ocrWindows(imagePath, lang = 'zh-Hans-CN') {
  const r = await runPs('ocr.ps1', { Image: imagePath, Lang: lang }, 60000);
  if (!r.ok) throw new Error(r.detail || r.error || 'ocr failed');
  r.engine = r.engine || 'windows-media-ocr';
  return r;
}

/**
 * 对图片做 OCR，返回结构化行文本（与 ocr.ps1 同构）
 * engine=auto：优先 PP-OCRv6/PaddleOCR，环境缺失或失败时自动回落 Windows OCR
 * engine=rapid：走 RapidOCR(ONNX) 通道（同一套 PP-OCRv6 识别模型，内存占用更低）
 */
async function ocrImage(imagePath, lang = 'zh-Hans-CN', opts = {}) {
  const mode = opts.engine || OCR_CFG.engine || 'auto';
  const prog = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  if (mode === 'tess') return await tess.ocrTess(imagePath, prog); // 纯离线直选
  if (mode === 'win') return await ocrWindows(imagePath, lang); // 系统内置直选：不走 tesseract 兜底
  if (usesPython(mode)) {
    const py = findPython(OCR_CFG.python);
    if (py) {
      try {
        const stage = mode === 'rapid' ? 'rapid-ocr' : 'paddle-ocr';
        if (prog) prog({ status: stage, p: 0.4 }); // 无逐帧进度，报阶段值
        const r = await ocrPaddle(imagePath, forceOf(mode));
        r.engine = r.engine || (mode === 'rapid' ? 'rapidocr-onnx' : 'paddleocr');
        if (prog) prog({ status: 'done', p: 1 });
        return r;
      } catch (e) {
        if (mode === 'paddle' || mode === 'rapid') throw e;
      }
    } else if (mode === 'paddle') {
      throw new Error('未找到 PaddleOCR 运行环境：请先安装 OCR 环境，或在后台「OCR 设置」中指定 Python 路径');
    } else if (mode === 'rapid') {
      throw new Error('未找到 RapidOCR 运行环境：请先在后台「OCR 设置」点「⚙ 一键离线安装环境」（RapidOCR 通道随包内置）');
    }
  }
  // tesseract.js 离线兜底（语言包就位即用，无 Python/网络依赖），再退系统 OCR
  try {
    const t = await tess.ocrTess(imagePath, prog);
    if (t.lines.length) return t;
  } catch (e) { /* 落到系统 OCR */ }
  if (prog) prog({ status: 'windows-ocr', p: 0.5 });
  return await ocrWindows(imagePath, lang);
}

/** 常驻 OCR 服务是否已拉起（模型已在内存，首次识别不用等加载） */
function ocrServerRunning() {
  try { return !!(_paddleSrv && _paddleSrv.child); } catch (e) { return false; }
}

async function ocrProbeInfo(force = false) {
  const now = Date.now();
  if (!force && _ocrProbeCache && now - _ocrProbeCache.at < OCR_PROBE_TTL) return _ocrProbeCache.data;
  if (_ocrProbeInflight) return _ocrProbeInflight; // 并发去重：多处同时问只探一次
  _ocrProbeInflight = (async () => {
    try {
      let data = null;
      if (ocrServerRunning()) {
        // 快路径：常驻服务已在跑，引擎已在内存 —— 毫秒级
        try {
          const r = await paddleServer(forceOf(OCR_CFG.engine)).request({ probe: true }, 15000);
          data = (r && r.ok) ? r : null;
        } catch (e) { data = null; }
      }
      if (!data) {
        try { data = await runPy('ocr_paddle.py', { probe: true }, 60000, OCR_CFG.python); }
        catch (e) { data = null; }
      }
      if (!data) data = { ok: false };
      _ocrProbeCache = { at: Date.now(), data };
      return data;
    } finally { _ocrProbeInflight = null; }
  })();
  return _ocrProbeInflight;
}

/** OCR 引擎可用性探测（后台设置页用）。force=true 跳过探针缓存重探（「检测环境」按钮）。 */
async function ocrStatus(force = false) {
  const py = findPython(OCR_CFG.python);
  const st = { engine: OCR_CFG.engine, tier: OCR_CFG.tier, python: py || '', paddle: false };
  try {
    const t = await tess.tessStatus();
    st.tess = t.ok; st.tessLive = t.live; st.tessVersion = t.version; st.tessError = t.error || '';
  } catch (e) { st.tess = false; st.tessError = String(e && e.message || e); }
  if (!py) return st;
  try {
    const r = await ocrProbeInfo(!!force);
    if (r && r.ok) {
      st.paddle = true;
      st.rapid = !!r.rapid; // true = 原生 paddle 核心不可用（CPU 无 AVX），auto 档走 RapidOCR(ONNX)
      st.rapidok = !!r.rapidok; // RapidOCR(ONNX) 通道可用（可主动选用）
      st.rapidver = r.rapidver || '';
      st.kind = r.kind || ''; // auto 档实际会用的通道：paddle | rapid
      st.paddleocr = r.paddleocr || '';
      st.paddlepaddle = r.paddle || '';
      st.models = r.models || [];
    }
  } catch (e) { st.error = String(e && e.message || e); }
  // 常驻 OCR 服务是否已预热（与 C# 宿主 Ocr.Status() 的 warm 同义）
  st.warm = ocrServerRunning();
  return st;
}

/** UIA 读取指定窗口句柄的控件文本（C/S 客户端精准通道） */
async function readUiAutomation(handle, { depth = 40, maxItems = 3000 } = {}) {
  const r = await runPs('uia.ps1', { Handle: handle, Depth: depth, MaxItems: maxItems }, 90000);
  if (!r.ok) throw new Error(r.error || 'uia failed');
  return r;
}

/** 纯中文药名行（与 analyze.js RE_HERB_NAME 同式） */
const RE_LTT_HERB = /^[\u3400-\u4dbf\u4e00-\u9fa5]{1,8}$/;
const RE_LTT_HASDOSE = /\d\s*(?:g|G|克)$/;

/** 剂量误读前置修复。
 * 小档位（tiny）OCR 常把「12g」误读成纯数字「128」（g→8/6/9），而纯数字行随后会被
 * 噪声过滤整行删除 → 剂量凭空丢失（「法半夏⏎浙贝母」孤行无剂量）。
 * 判据（尽量唯一，不盲改）：纯数字 token 紧跟一个「未带剂量的纯中文药名」token，
 * 且几何上位于药名右侧同一行（剂量列位置；HIS 行号在名称左侧，不会误伤）。
 * 解读：3 位且尾数 8/6/9 → 去尾取前两位「12g」；2 位 → 原数「15g」；其余保持原样。 */
function fixMisreadDoseTokens(toks) {
  for (let i = 0; i < toks.length; i++) {
    const s = (toks[i].t || '').trim();
    if (!/^\d{1,3}$/.test(s)) continue;
    for (let j = i - 1; j >= 0; j--) {
      const p = (toks[j].t || '').trim();
      if (!p) continue;
      if (RE_LTT_HASDOSE.test(p)) break;   // 前药已带剂量 → 数字更像行号噪声，不动
      if (!RE_LTT_HERB.test(p)) break;     // 非纯中文药名行 → 不动
      // 几何校验（有坐标才启用）：数字须在药名右侧且同行
      if (toks[i].x != null && toks[j].x != null && toks[i].x <= toks[j].x) break;
      if (toks[i].y != null && toks[j].y != null && Math.abs(toks[i].y - toks[j].y) > 12) break;
      const dose = (s.length === 3 && '869'.includes(s[2])) ? s.slice(0, 2)
                 : (s.length === 2 ? s : null);
      if (dose != null && +dose >= 1 && +dose <= 99) toks[i].t = dose + 'g';
      break;
    }
  }
}

/** 从 OCR lines 拼纯文本（剔除 HIS 界面标签/符号碎片等噪声行；竖排处方"药名⏎克数"自动并回同行） */
function linesToText(lines) {
  const { isNoiseLine } = require('./noise'); // 注意：noise.js 导出的是命名函数，不是 { noise } 对象
  const { mergeDoseLines } = require('./analyze');
  const toks = (lines || []).map(l => ({
    t: normalizeOcrText(l && l.text),
    x: (l && typeof l.x === 'number') ? l.x : null,
    y: (l && typeof l.y === 'number') ? l.y : null,
  }));
  fixMisreadDoseTokens(toks);
  return mergeDoseLines(
    toks
      .map(o => o.t)
      .filter(t => t && t.trim() && !isNoiseLine(t))
      .join('\n')
  );
}

/** OCR 归一化：全角字母数字/句点转半角；去除 CJK 字符间 OCR 逐字空格
 *  opts.keepSpaces=true（剪贴板/原生文本）：不做"去汉字间空格"，避免把"创伤病 气滞血瘀证"粘成一个词 */
function normalizeOcrText(s, opts) {
  const keep = !!(opts && opts.keepSpaces);
  let t = String(s || '');
  // 全角 ０-９ Ａ-Ｚ ａ-ｚ 及全角句点 ． → 半角（4．5 → 4.5）
  t = t.replace(/[０-９Ａ-Ｚａ-ｚ．]/g, ch => ch === '．' ? '.' : String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  if (keep) return t;
  const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fa5\u201c\u201d\u2018\u2019，。、；：？！…—（）《》【】·％·';
  // 汉字/中文标点之间的空白逐对去掉（"党 参 12 克" → "党参 12克"）
  const re1 = new RegExp('([' + CJK + '])[ \\t\\u00a0]+(?=[' + CJK + '])', 'g');
  let prev;
  do { prev = t; t = t.replace(re1, '$1'); } while (t !== prev);
  // 数字/字母/百分号 与 汉字 之间空格也去掉（"12 克" → "12克"）
  const re2 = new RegExp('([0-9A-Za-z%.])[ \\t\\u00a0]+(?=[' + CJK + '])', 'g');
  do { prev = t; t = t.replace(re2, '$1'); } while (t !== prev);
  // 小数点两侧空格合并（"4 . 5" → "4.5"）
  t = t.replace(/(\d)[ \t\u00a0]+\./g, '$1.').replace(/\.[ \t\u00a0]+(\d)/g, '.$1');
  return t;
}

/** 简易清理：OCR 归一化 + 折叠重复空白（keepSpaces 时保留词间空格） */
function cleanText(t, opts) {
  const keep = !!(opts && opts.keepSpaces);
  return String(t || '')
    .split('\n').map(s => normalizeOcrText(s, opts).replace(/[ \t\u00a0]+/g, keep ? ' ' : ' ').trim()).filter(Boolean).join('\n');
}

/** 预热：提前拉起常驻 OCR 服务并加载模型（避免首次截图等待） */
function warmupOcr() {
  try {
    const mode = OCR_CFG.engine || 'auto';
    if (!usesPython(mode)) return false;
    if (!findPython(OCR_CFG.python)) return false;
    const srv = paddleServer(forceOf(mode));
    if (srv && srv.child) return true;
    srv.request({ image: '' }, 60000).catch(() => { /* 预热失败忽略，正式调用时再回落 */ }).then(() => {
      // 引擎已就绪 → 顺手把环境探针结论填进缓存（~3ms），后台「OCR 引擎」页开页即出。
      // 这一步把「开页要等 12 秒冷探针」彻底挪到用户无感的后台。
      if (!ocrServerRunning()) return;
      try { ocrProbeInfo(true).catch(() => { /* 忽略 */ }); } catch (e) { /* 忽略 */ }
    });
    return true;
  } catch (e) { return false; }
}

function stopOcrServer() { if (_paddleSrv) { try { _paddleSrv.stop(); } catch (e) { /* 忽略 */ } _paddleSrv = null; } }

module.exports = {
  TMP_DIR, getForegroundWindow, captureRegion, ocrImage, readUiAutomation, linesToText, cleanText, normalizeOcrText,
  setOcrConfig, ocrConfig, ocrStatus, stopOcrServer, warmupOcr
};
