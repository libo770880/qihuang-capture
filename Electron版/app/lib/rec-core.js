// lib/rec-core.js - 动图录制内核（离屏窗口逐帧抓取 + 动作时间轴）
// 供 lib/rec-gif.js（主进程内，真实后端）与 scripts/_rec_overlay.js（独立宿主，fixture）共用。
// 产物：.probe/gif/<scene>/f0001.png … + meta.json（帧率/字幕段/点击点），由 scripts/_gif_build.py 合成 GIF。
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.QHJF_GIF_OUT || path.join(ROOT, '.probe', 'gif');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 离屏/隐藏窗口：paintWhenInitiallyHidden 让隐藏窗口仍持续合成（动画不冻），
// 若该策略在本机不可用（capturePage 空图），回退到可见窗口。
async function openWin(html, w, h, opt = {}) {
  const prefs = {
    preload: path.join(ROOT, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    offscreen: false,
  };
  const url = pathToFileURL(path.join(ROOT, 'renderer', html)).href;
  const tries = [
    ['hidden-paint', { width: w, height: h, show: false, frame: false, x: opt.x || 40, y: opt.y || 40, transparent: !!opt.transparent, webPreferences: { ...prefs, paintWhenInitiallyHidden: true } }],
    ['visible', { width: w, height: h, show: true, frame: false, x: opt.x || 40, y: opt.y || 40, transparent: !!opt.transparent, webPreferences: prefs }],
  ];
  let lastErr = null;
  for (const [tag, opt] of tries) {
    try {
      const win = new BrowserWindow(opt);
      win.setContentSize(w, h);
      await win.loadURL(url);
      await sleep(700);
      const img = await Promise.race([win.webContents.capturePage(), sleep(6000).then(() => null)]);
      const ok = !!(img && img.getSize().width > 0);
      if (ok) { win.__recTag = tag; return win; }
      win.destroy();
    } catch (e) { lastErr = e; }
  }
  throw new Error('录制窗口创建失败 ' + html + '：' + (lastErr && lastErr.message || 'capture empty'));
}

class Recorder {
  constructor(name, win, fps = 10) {
    this.name = name;
    this.win = win;
    this.fps = fps;
    this.dir = path.join(OUT, name);
    this.frames = 0;
    this.marks = [];
    this.clicks = [];
    this.scrolls = [];
    this._stop = false;
    this._task = null;
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }

  get js() { return (code) => this.win.webContents.executeJavaScript(code); }
  get now() { return this.frames; }

  async start() {
    const tick = async () => {
      while (!this._stop) {
        const t0 = Date.now();
        try {
          const img = await Promise.race([this.win.webContents.capturePage(), sleep(2500).then(() => null)]);
          if (img && img.getSize().width > 0) {
            fs.writeFileSync(path.join(this.dir, 'f' + String(this.frames).padStart(4, '0') + '.png'), img.toPNG());
            this.frames++;
          }
        } catch (e) { /* 单帧失败跳过 */ }
        const dt = Date.now() - t0;
        await sleep(Math.max(16, Math.round(1000 / this.fps) - dt));
      }
    };
    this._task = tick();
    await sleep(400);
    return this;
  }

  async stop() {
    this._stop = true;
    try { await this._task; } catch (e) { /* ignore */ }
    const meta = {
      name: this.name, fps: this.fps, frames: this.frames,
      w: this.win.getContentSize()[0], h: this.win.getContentSize()[1],
      marks: this.marks, clicks: this.clicks, scrolls: this.scrolls,
      tag: this.win.__recTag || ''
    };
    fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify(meta, null, 1));
    return meta;
  }

  // 字幕：从当前帧起显示 label，直到下一次 mark
  mark(label) { this.marks.push({ f: this.frames, label: String(label) }); }

  // 中途换窗：画面切到新窗口继续录（两窗 CSS 尺寸必须一致，帧尺寸不变、时间轴连续）
  swap(win2) { this.win = win2; }

  async wait(ms) { await sleep(ms); }

  // 元素中心点（CSS 像素）
  async center(sel) {
    return this.js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  }

  // 真实点击（DOM click，走页面真实事件链），并记录点击点用于画涟漪
  async click(sel, opt = {}) {
    const c = await this.center(sel);
    if (!c) { this.marks.push({ f: this.frames, label: '［未命中 ' + sel + '］' }); return false; }
    this.clicks.push({ f: this.frames, x: c.x, y: c.y, label: opt.label || '' });
    await sleep(90);
    await this.js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false; el.scrollIntoView({ block: 'nearest' }); el.click(); return true; })()`);
    if (opt.after) await sleep(opt.after);
    return true;
  }

  // 标注位置（画涟漪+光标）但不点击 —— 用于"指给你看"的入口展示
  async spot(sel, opt = {}) {
    const c = await this.center(sel);
    if (!c) return false;
    this.clicks.push({ f: this.frames, x: c.x, y: c.y, label: opt.label || '' });
    if (opt.after) await sleep(opt.after);
    return true;
  }

  // 直接派发鼠标事件（框选/拖拽用）
  async mouseAt(type, x, y) {
    await this.js(`document.dispatchEvent(new MouseEvent(${JSON.stringify(type)},
      { bubbles: true, cancelable: true, button: 0, buttons: ${type === 'mouseup' ? 0 : 1}, clientX: ${x}, clientY: ${y} })); true`);
  }

  // 逐帧滚动（不依赖 smooth 动画，离屏也能出画面）
  async scroll(sel, deltaY, ms = 520) {
    const steps = Math.max(1, Math.round(ms / (1000 / this.fps)));
    this.scrolls.push({ f: this.frames, sel, deltaY, steps });
    await this.js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 0;
      el.__recFrom = el.scrollTop; return 1; })()`);
    for (let i = 1; i <= steps; i++) {
      await sleep(1000 / this.fps);
      await this.js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 0;
        const t = ${i} / ${steps}; el.scrollTop = el.__recFrom + (${deltaY}) * (1 - Math.pow(1 - t, 3)); return 1; })()`);
    }
  }

  // 逐字输入（搜索框演示用）
  async type(sel, text, msPerChar = 55) {
    await this.js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 0;
      el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    for (const ch of text) {
      await sleep(msPerChar);
      await this.js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 0;
        el.value += ${JSON.stringify(ch)}; el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    }
  }

  // 等待条件成立（真实异步任务：分析/点评/检索），超时记标记
  async until(expr, timeout = 20000, every = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await this.js(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return true; } catch (e) { /* ignore */ }
      await sleep(every);
    }
    return false;
  }
}

module.exports = { Recorder, openWin, sleep, OUT, ROOT };
