// 在 Electron 主进程内验证 tess.js 放大识别效果（nativeImage 仅 Electron 可用）
const { app } = require('electron');
const tess = require('../lib/tess');
tess.setLog(m => console.log('[tess]', m));

app.whenReady().then(async () => {
  try {
    const t0 = Date.now();
    const img = process.env.TESS_IMG || process.argv[2];
    const r = await tess.ocrTess(img);
    console.log('elapsed=' + ((Date.now() - t0) / 1000).toFixed(1) + 's lines=' + r.lines.length);
    console.log('--- text ---');
    console.log(r.text);
    const cjk = (r.text.match(/[\u4e00-\u9fa5]/g) || []).length;
    console.log('--- cjk count:', cjk);
    await tess.stopTess();
    app.exit(0);
  } catch (e) { console.error('FAIL', e); app.exit(1); }
});
