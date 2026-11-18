// scripts/_rec_admocr.js - 后台「OCR 引擎」页演示动图
// 流程：进入 OCR 引擎页 → 切识别引擎 → 档位说明 → 检测环境 ✓ → 保存 → 引擎说明卡
// 用法：electron scripts/_rec_admocr.js
const { app, ipcMain } = require('electron');
const path = require('path');
const { Recorder, openWin, sleep } = require('../lib/rec-core');

const log = (m) => console.log('[rec] ' + m);

const ST = {
  engine: 'rapid', paddle: true, rapid: true, rapidok: true, rapidver: '1.3.24',
  paddlepaddle: 'onnxruntime', tier: 'tiny', warm: true,
  tess: true, tessVersion: '6.0.0', tessLive: true,
  models: ['PP-OCRv6 (tiny · 1.5M · 内置)', 'ch_PP-OCRv4_det_infer.onnx', 'ch_ppocr_mobile_v2.0_cls_infer.onnx'],
};
ipcMain.handle('ui:prefs-get', () => ({}));
ipcMain.handle('ui:prefs-set', () => ({ ok: true }));
ipcMain.handle('ocr:config-get', () => ({ engine: 'rapid', tier: 'tiny', python: '' }));
ipcMain.handle('ocr:config-set', (e, patch) => ({ ok: true, ...patch }));
ipcMain.handle('ocr:status', () => ST);
ipcMain.handle('ocr:env-install', () => ({ ok: true }));
ipcMain.handle('sys:get', () => ({}));
ipcMain.handle('ai:config-get', () => ({ hasKey: true, modelLabel: 'DeepSeek · deepseek-chat' }));
ipcMain.handle('kb:stats', () => ({ herbs: 385, formulas: 322, diag: 35587, symptom: 0, westmap: 0 }));
ipcMain.handle('kb:list-all', () => ({ herbs: [], formulas: [] }));
ipcMain.handle('app:version', () => 'demo');

app.whenReady().then(async () => {
  const win = await openWin('admin.html', 1280, 800);
  const js = win.webContents.executeJavaScript.bind(win.webContents);
  await sleep(900);
  await js(`(function(){ try { switchView('ocr'); ocrTabInit(); } catch(e) {} return 1; })()`);
  await sleep(1200);
  const r = new Recorder('19-后台OCR引擎', win, 10);
  await r.start();
  r.mark('① 后台管理 → OCR 引擎：识别质量决定辨证/审方准确性');
  await r.wait(2200);
  r.mark('② 识别引擎五级策略：PP-OCRv6 / RapidOCR / tesseract / 系统 OCR 自动回落');
  await js(`(function(){ const s = document.getElementById('ocrEngine'); s.value = 'rapid'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await r.wait(1900);
  r.mark('③ 模型档位 tiny：1.5M 最快，实测与 medium 内容等价、快约 10 倍');
  await r.spot('#ocrTier', { after: 1700 });
  r.mark('④ 点「检测环境」→ 毫秒级返回（缓存 + 常驻服务快路径）');
  await r.click('button.btn:nth-of-type(2)', { after: 300 });
  await js(`(function(){ try { ocrProbe(true); } catch(e) {} return 1; })()`);
  await r.wait(2000);
  r.mark('⑤ ✓ 环境可用 · RapidOCR(ONNX) · 已常驻内存 · 识别免加载');
  await r.wait(2200);
  r.mark('⑥ 保存设置 → 配置入库，搬家随 data.db 走');
  await js(`(function(){ try { ocrSave(); } catch(e) {} return 1; })()`);
  await r.wait(1800);
  r.mark('⑦ 引擎说明：无 AVX 自动切 ONNX 通道 · 两级纠错始终生效');
  await js(`(function(){ const c = document.querySelectorAll('#v-ocr .card')[1]; if (c) c.scrollIntoView({ block: 'start' }); return 1; })()`);
  await r.wait(2200);
  const meta = await r.stop();
  win.destroy();
  log('scene admocr -> ' + JSON.stringify({ frames: meta.frames, w: meta.w, h: meta.h }));
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
