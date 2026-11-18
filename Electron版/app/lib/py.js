// lib/py.js - 统一封装 Python 桥接脚本调用（用于 PaddleOCR 等高精度引擎）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

/** 候选 Python 解释器（OCR 专用环境）：自定义 > 环境变量 > 托管环境 > 项目 runtime */
function candidatePythons(extra) {
  const list = [];
  if (extra) list.push(extra);
  if (process.env.QHJF_OCR_PY) list.push(process.env.QHJF_OCR_PY);
  const home = os.homedir();
  list.push(path.join(home, '.workbuddy', 'binaries', 'python', 'envs', 'ocr', 'Scripts', 'python.exe'));
  list.push(path.join(home, '.workbuddy', 'binaries', 'python', 'envs', 'ocr', 'bin', 'python3'));
  list.push(path.join(__dirname, '..', 'runtime', 'ocr', 'Scripts', 'python.exe'));
  list.push(path.join(__dirname, '..', 'runtime', 'ocr', 'bin', 'python3'));
  list.push(path.join(__dirname, '..', 'runtime', 'ocr', 'python.exe'));
  return [...new Set(list.filter(Boolean))];
}

/** 找到可用的 OCR Python 解释器；找不到返回 null */
function findPython(extra) {
  for (const p of candidatePythons(extra)) {
    try { if (p && fs.existsSync(p)) return p; } catch (e) { /* 忽略 */ }
  }
  return null;
}

/**
 * 运行一个 python 桥接脚本，解析 stdout 的 JSON。
 * 参数会被转为 --key value（布尔 true → --key，false/undefined 忽略）。
 */
function runPy(scriptName, args = {}, timeoutMs = 180000, extraPython = '') {
  return new Promise((resolve, reject) => {
    const py = findPython(extraPython);
    if (!py) { reject(new Error('NO_PYTHON')); return; }
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const pyArgs = [scriptPath];
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined || v === null || v === false) continue;
      const flag = '--' + k.replace(/_/g, '-').replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      if (v === true) { pyArgs.push(flag); continue; }
      pyArgs.push(flag, String(v));
    }
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', FLAGS_call_stack_level: '0' };
    // 清掉外部注入的 sitecustomize（安全删除 shim 会拦截 python 的文件操作）
    delete env.PYTHONPATH;
    delete env.PYTHONSTARTUP;
    env.PYTHONNOUSERSITE = '1';
    const child = spawn(py, pyArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: SCRIPTS_DIR,
      env
    });
    let out = '', err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* 忽略 */ }
      reject(new Error(`[${scriptName}] timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      // 取最后一行的 JSON（脚本可能带前置日志行）
      const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      let parsed = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const s = lines[i];
        if (!s.startsWith('{')) continue;
        try { parsed = JSON.parse(s); break; } catch (e) { /* 继续往前找 */ }
      }
      if (!parsed) {
        reject(new Error(`[${scriptName}] no json output (exit ${code}) stderr=${err.slice(-400)}`));
        return;
      }
      resolve(parsed);
    });
  });
}

/**
 * 常驻 Python 服务（用于 PaddleOCR：模型加载一次，后续请求 ~1-2s）
 * - 惰性启动：首次 request 时 spawn
 * - 请求串行：stdin 写一行，stdout 回一行 JSON
 * - 空闲 15 分钟自动退出释放内存；进程异常退出后可自动重启
 */
class PyServer {
  constructor(scriptName, args = {}, extraPython = '', idleMs = 15 * 60 * 1000) {
    this.scriptName = scriptName;
    this.args = args;
    this.extraPython = extraPython;
    this.idleMs = idleMs;
    this.child = null;
    this.queue = [];
    this.buffer = '';
    this.dead = false;
    this.timer = null;
    this.ready = null;
  }

  _spawn() {
    const py = findPython(this.extraPython);
    if (!py) { this.dead = true; return null; }
    const scriptPath = path.join(SCRIPTS_DIR, this.scriptName);
    const pyArgs = [scriptPath];
    for (const [k, v] of Object.entries(this.args)) {
      if (v === undefined || v === null || v === false) continue;
      const flag = '--' + k.replace(/_/g, '-').replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      if (v === true) { pyArgs.push(flag); continue; }
      pyArgs.push(flag, String(v));
    }
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', FLAGS_call_stack_level: '0' };
    delete env.PYTHONPATH;
    delete env.PYTHONSTARTUP;
    env.PYTHONNOUSERSITE = '1';
    const child = spawn(py, pyArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: SCRIPTS_DIR, env });
    this.child = child;
    this.buffer = '';
    child.stdout.on('data', d => this._onData(d.toString('utf8')));
    child.stderr.on('data', () => { /* 日志丢弃 */ });
    child.on('error', () => this._onExit());
    child.on('close', () => this._onExit());
    return child;
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line || line[0] !== '{') continue;
      let obj = null;
      try { obj = JSON.parse(line); } catch (e) { continue; }
      if (obj && obj.ready) continue; // 引擎就绪握手
      const pending = this.queue.shift();
      if (pending) pending.resolve(obj);
    }
  }

  _onExit() {
    const err = new Error('OCR 服务进程已退出');
    while (this.queue.length) this.queue.shift().reject(err);
    this.child = null;
  }

  /** 发送一次识别请求，返回 {ok, lines} */
  request(payload, timeoutMs = 120000) {
    if (this.dead) return Promise.reject(new Error('NO_PYTHON'));
    return new Promise((resolve, reject) => {
      const item = { resolve, reject };
      this.queue.push(item);
      if (!this.child) {
        const c = this._spawn();
        if (!c) { this.queue.pop(); reject(new Error('NO_PYTHON')); return; }
      }
      try {
        this.child.stdin.write((typeof payload === 'string' ? payload : JSON.stringify(payload)) + '\n');
      } catch (e) {
        this.queue.pop();
        reject(e);
        return;
      }
      // 超时保护：避免单次请求卡死整条队列
      const t = setTimeout(() => {
        const i = this.queue.indexOf(item);
        if (i >= 0) { this.queue.splice(i, 1); reject(new Error('OCR 请求超时')); }
      }, timeoutMs);
      const wrap = (fn) => (v) => { clearTimeout(t); fn(v); };
      item.resolve = wrap(resolve);
      item.reject = wrap(reject);
      this._touchIdle();
    });
  }

  _touchIdle() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop(), this.idleMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const c = this.child;
    this.child = null;
    if (!c) return;
    try { c.stdin.write('__exit__\n'); } catch (e) { /* 忽略 */ }
    setTimeout(() => { try { c.kill(); } catch (e) { /* 忽略 */ } }, 800);
  }
}

module.exports = { runPy, findPython, PyServer, SCRIPTS_DIR };
