// 逐屏截图 demo-tcm.html（PPT 素材自检 + 可直接取用）
// 用法：electron scripts/_shot_demo.js   → .probe/demo/s00.png … s11.png
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.probe', 'demo');
fs.mkdirSync(OUT, { recursive: true });
// 可选参数：scripts/_shot_demo.js [demo-admin.html] [前缀]  → 默认 demo-tcm.html / s
const PAGE = process.argv[2] || 'demo-tcm.html';
const PRE = process.argv[3] || 's';
const IDS = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09'];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 810, show: false,
    webPreferences: { backgroundThrottling: false },
  });
  win.setContentSize(1440, 810);
  for (const id of IDS) {
    try {
      await win.loadFile(path.join(ROOT, PAGE), { query: { m: id } });
    } catch (e) {
      console.log(PRE ? 'a' + id : 's' + id + '  load retry (' + e.message + ')');
      await new Promise(r => setTimeout(r, 300));
      await win.loadFile(path.join(ROOT, PAGE), { query: { m: id } });
    }
    await new Promise(r => setTimeout(r, 350));
    const info = await win.webContents.executeJavaScript(`(function(){
      var s=document.querySelector('.slide'); if(!s) return {err:'no slide'};
      var r=s.getBoundingClientRect(), over=[];
      s.querySelectorAll('*').forEach(function(el){
        if(el.classList && el.classList.contains('cw')) return;   // 封面铺满容器属正常
        var b=el.getBoundingClientRect();
        if(b.bottom > r.bottom-2 || b.right > r.right-2) over.push((el.className||el.tagName)+'@'+(Math.round(b.bottom-r.bottom))+'/'+(Math.round(b.right-r.right)));
      });
      return {w:Math.round(r.width),h:Math.round(r.height),over:over.slice(0,8),n:over.length,sh:s.scrollHeight};
    })()`);
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1440, height: 810 });
    fs.writeFileSync(path.join(OUT, PRE + id + '.png'), img.toPNG());
    console.log(PRE + id + '  ' + info.w + 'x' + info.h + '  overflow=' + (info.n || 0) + (info.n ? '  ' + info.over.join(' | ') : ''));
  }
  console.log('done -> ' + OUT);
  win.destroy();
  app.quit();
});
