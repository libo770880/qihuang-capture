// lib/rec-gif.js - 演示动图录制（--rec-gif 启动参数触发，跑完自动退出）
// 复用 main.js 已注册的 IPC 与真实后端（真实库、真实分析引擎），
// 只是把 renderer 页面装进离屏窗口，逐帧 capturePage 出 PNG 序列。
// 合成交给 scripts/_gif_build.py（字幕条 / 点击涟漪 / 调色板 / GIF）。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { Recorder, openWin, sleep, OUT, ROOT } = require('./rec-core');

let LOG = '';
function log(m) {
  LOG += `[${new Date().toISOString().slice(11, 19)}] ${m}\n`;
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, '_rec.log'), LOG); } catch (e) { /* ignore */ }
  console.log('[rec] ' + m);
}

// 演示记录：按患者名找（库里 3 条带处方的演示病历）
async function findRec(js, patient) {
  return js(`(async () => {
    const rs = await window.qhjf.listRecords();
    const r = rs.find(x => String((x.patient||'') + (x.text||'') ).includes(${JSON.stringify(patient)})) || rs[0];
    return r ? r.id : '';
  })()`);
}

// 清空记录的分析结果（录制「现场分析」过程用；只在隔离数据副本上做）
function resetAnalysis(rid) {
  try {
    const DB = require('./db');
    const patch = {};
    for (const k of ['tcm', 'compliance', 'analyzedAt', 'rxAddedAt', 'editedAt', 'diagCheck']) patch[k] = undefined;
    DB.recPatch(rid, patch);
    log('reset analysis: ' + rid);
  } catch (e) { log('reset ERR: ' + e.message); }
}

// ---------- 场景 1：处方解析与审方 ----------
async function sceneRxAnalyze() {
  const win = await openWin('panel.html', 1100, 720);
  const r = new Recorder('04-处方解析与审方', win, 10);
  const js = r.js;
  const rid = await findRec(js, '郑某某');
  log('record = ' + rid);
  resetAnalysis(rid);
  await js(`(async () => { cur = null; await refresh(); return 1; })()`);
  await sleep(800);
  await r.start();

  r.mark('① 采集记录列表：按科室 / 状态筛选');
  await r.wait(1200);

  r.mark('② 打开门诊记录（原文已脱敏）');
  await r.click(`.rec[data-id="${rid}"]`, { after: 1100 });

  r.mark('③ 点「本地分析」：辨证 · 方剂反查 · 审方');
  const hasBtn = await r.until(`document.querySelector('#wbRun')`, 5000);
  await r.scroll('#main', 560, 700);
  if (hasBtn) await r.click('#wbRun', { after: 350 });
  else await js('wbRunLocal()');

  r.mark('④ 分析引擎运算中…（本地知识库，不经外网）');
  const ok = await r.until(`document.querySelector('.tcm')`, 45000);
  log('analysis done = ' + ok);
  r.mark('⑤ 辨证结论：病名 · 证型 · 治法 · 方剂溯源');
  await r.wait(1800);
  await r.scroll('#main', 420, 700);
  r.mark('⑥ 处方解析：逐味药 + 剂量 + 用法核对');
  await r.wait(1800);
  await r.scroll('#main', 380, 700);
  r.mark('⑦ 安全审方：配伍禁忌 / 剂量 / 疗程 / 相符性');
  await r.wait(2200);

  const meta = await r.stop();
  win.destroy();
  return meta;
}

// 滚动到某元素（相对当前 scrollTop 平滑滚动，离屏窗口也能出画面）
async function scrollTo(r, sel, offset = 120) {
  const d = await r.js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    const box = document.querySelector('#main') || document.querySelector('.view.on');
    if (!el || !box) return 0;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    return Math.round(top - box.scrollTop - ${offset}); })()`);
  if (d) await r.scroll('#main', d, 620);
  return d;
}

// ---------- 场景 6：AI 智能解读（面板） ----------
async function sceneAiRead() {
  const win = await openWin('panel.html', 1100, 720);
  const r = new Recorder('10-AI智能解读', win, 10);
  const js = r.js;
  const rid = await findRec(js, '周某某');
  log('record = ' + rid);
  await js(`(async () => { cur = null; await refresh(); return 1; })()`);
  await sleep(700);
  await r.start();
  r.mark('① 记录详情 → AI 智能解读（本地分析之上再加一层）');
  await r.click(`.rec[data-id="${rid}"]`, { after: 1100 });
  await r.wait(600);
  await scrollTo(r, '#aiCard', 150);
  r.mark('② 一键生成：病历质控 + 辨证推理链 + 处方点评');
  await r.wait(1200);
  await r.js(`(function(){ const b = [...document.querySelectorAll('#aiCard button')].find(x=>/生成 AI 解读/.test(x.textContent)); if (b) { b.click(); return 1; } return 0; })()`);
  r.mark('③ 上下文自动带入：脱敏文本 + 规则引擎结果');
  await r.until(`document.querySelector('#aiProgBar')`, 10000);
  await r.wait(1800);
  r.mark('④ 模型推理中…（较长时自动续写，无需操作）');
  const ok = await r.until(`document.querySelector('#aiCard .md') && document.querySelector('#aiCard .md').textContent.indexOf('证型与治法') >= 0`, 90000);
  log('ai done = ' + ok);
  r.mark('⑤ 输出结构化解读：证据 → 证型 → 治法 → 建议');
  await r.wait(1800);
  await r.scroll('#main', 380, 700);
  r.mark('⑥ 全文可读、可续写；结论仅供辅助，须医师核对');
  await r.wait(2200);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 7：医保规则库（后台） ----------
async function sceneYbAdmin() {
  const win = await openWin('admin.html', 1240, 800);
  const r = new Recorder('11a-医保规则库', win, 10);
  const js = r.js;
  await sleep(900);
  await r.start();
  r.mark('① 后台管理 → 审方规则 → 医保规则');
  await js(`switchView('yibao'); ybInit(); "ok"`);
  const ok = await r.until(`document.querySelector('#ybTbl table tbody tr')`, 20000);
  log('yibao table = ' + ok);
  r.mark('② 支付类别维护：甲类 / 乙类 / 丙类 / 自费');
  await r.wait(2000);
  r.mark('③ 逐味维护：医保编码 · 限定支付范围 · 自付比例');
  await r.wait(1800);
  // 筛「自费」：全库 383 味中只有 10 味自费，最直观
  await js(`(function(){ const s=document.getElementById('ybFilter'); s.value='自费'; renderYb(); return 1; })()`);
  r.mark('④ 按类别筛选：一眼看清全库自费饮片');
  await r.wait(1900);
  await r.scroll('#v-yibao .imp', 300, 700);
  r.mark('⑤ 药名 / 编码 / 备注 检索，支持 Excel 批量导入导出');
  await r.type('#ybSearch', '西红花', 130);
  await r.wait(1600);
  r.mark('⑥ 单味规则可改可删：处方分析时按此判医保支付');
  await r.wait(2000);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 8：前台医保合规提示（面板） ----------
async function sceneYbWarn() {
  const win = await openWin('panel.html', 1100, 720);
  const r = new Recorder('11b-医保合规提示', win, 10);
  const js = r.js;
  const rid = await findRec(js, '周某某');
  log('record = ' + rid);
  await js(`(async () => { cur = null; await refresh(); return 1; })()`);
  await sleep(700);
  await r.start();
  r.mark('① 采集入库后自动跑本地分析（规则引擎，秒级）');
  await r.click(`.rec[data-id="${rid}"]`, { after: 1300 });
  r.mark('② 处方合规分析：自费药味红色提示');
  const d = await js(`(() => {
    const box = document.querySelector('#main');
    const hits = [...document.querySelectorAll('.it')].filter(x => /自费|限定支付|医保/.test(x.textContent));
    if (!hits.length) return -1;
    const t = hits[0].getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    return Math.round(t - box.scrollTop - 190);
  })()`);
  log('yb block delta = ' + d);
  if (d > 0) await r.scroll('#main', d, 900);
  else await r.scroll('#main', 420, 700);
  await r.wait(2200);
  r.mark('③ 自费药逐味列出：基金不予支付，需患者知情');
  await r.wait(2000);
  await r.scroll('#main', 300, 700);
  r.mark('④ 限定支付 / 乙类丙类：蓝色提示「超出范围不予支付」');
  await r.wait(2000);
  r.mark('⑤ 审方印章同步降级：提示项计入「需复核」');
  await r.wait(2000);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 9：OCR 多引擎（后台） ----------
async function sceneOcrModes() {
  const win = await openWin('admin.html', 1240, 800);
  const r = new Recorder('12-OCR多引擎', win, 10);
  const js = r.js;
  await sleep(900);
  await r.start();
  r.mark('① 后台管理 → OCR 引擎（识别质量决定后续审方准确性）');
  await js(`switchView('ocr'); ocrTabInit(); "ok"`);
  await r.until(`document.getElementById('ocrSt') && document.getElementById('ocrSt').textContent.length > 6`, 25000);
  await r.wait(1500);
  r.mark('② 当前环境：自动择优（PP-OCRv6 → tesseract → 系统 OCR）');
  await r.wait(2200);
  const pick = async (v, label) => {
    await js(`(function(){ const s=document.getElementById('ocrEngine'); s.value=${JSON.stringify(v)};
      s.dispatchEvent(new Event('change',{bubbles:true})); return s.value; })()`);
    r.mark(label);
    await r.wait(1500);
  };
  await pick('paddle', '③ PP-OCRv6：百度飞桨第六代，中文精度再提升 5.1%');
  await pick('rapid', '④ RapidOCR（ONNX）：同样精度，内存占用更低');
  await pick('tess', '⑤ tesseract.js：纯离线，无需 Python / 不联网');
  await pick('win', '⑥ 系统内置 OCR：零依赖，装机即用');
  await pick('auto', '⑦ 生产建议：自动择优，环境缺失自动回落');
  await js(`(function(){ const s=document.getElementById('ocrTier'); s.value='medium';
    s.dispatchEvent(new Event('change',{bubbles:true})); return 1; })()`);
  r.mark('⑧ 模型档位可调：tiny 最快 / medium 最全');
  await r.wait(1500);
  await js(`(function(){ const s=document.getElementById('ocrTier'); s.value='tiny';
    s.dispatchEvent(new Event('change',{bubbles:true})); return 1; })()`);
  await r.wait(900);
  r.mark('⑨ 一键检测环境 / 一键离线安装（无网也能部署）');
  await js(`(function(){ const b=[...document.querySelectorAll('#v-ocr .cbtns .btn')].find(x=>/检测环境/.test(x.textContent)); if(b) b.click(); return 1; })()`);
  await r.wait(2800);
  await r.scroll('#v-ocr .imp', 260, 700);
  r.mark('⑩ 环境明细：各引擎版本与可用性一目了然');
  await r.wait(2200);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 10：多模型接入（后台） ----------
async function sceneAiModels() {
  const win = await openWin('admin.html', 1240, 800);
  const r = new Recorder('13-多模型接入', win, 10);
  const js = r.js;
  await sleep(900);
  await r.start();
  r.mark('① 后台管理 → AI 设置：一个模型可管全部 AI 能力');
  await js(`switchView('ai'); aiTabInit(); "ok"`);
  await sleep(1500);
  r.mark('② 支持 DeepSeek / 通义千问 / 智谱 GLM / Kimi');
  await r.wait(2000);
  await js(`(function(){ const b=[...document.querySelectorAll('#v-ai .cbtns .btn')].find(x=>/添加模型/.test(x.textContent)); if(b) b.click(); return 1; })()`);
  r.mark('③ 新增一条模型：名称 · 接口地址 · 模型名 · Key');
  await r.wait(1400);
  // 再加一行（本地部署），两行都建好后再统一填值 —— 「添加模型」会重渲染列表，先填的行会被清空
  await js(`(function(){ const b=[...document.querySelectorAll('#v-ai .cbtns .btn')].find(x=>/添加模型/.test(x.textContent)); if(b) b.click(); return 1; })()`);
  await r.wait(600);
  const fillRow = (idx, fields) => js(`(function(){
    const rows=[...document.querySelectorAll('.ai-mrow')]; const row=rows[rows.length${idx}]; if(!row) return 0;
    const vals = ${JSON.stringify(fields)};
    for (const [f, v] of vals) { const el=row.querySelector('[data-f=' + f + ']'); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }
    return 1; })()`);
  // 新行①：通义千问视觉模型（AI 识图）
  await fillRow(-2, [['label', '通义千问（视觉）'], ['baseURL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'], ['model', 'qwen-vl-max-latest'], ['role', 'vision']]);
  r.mark('④ 云端视觉模型：AI 识图转录中药名与剂量更准');
  await r.wait(1800);
  // 新行②：本地部署（Ollama / LM Studio / vLLM，OpenAI 兼容）
  await fillRow(-1, [['label', '本地模型（Ollama）'], ['baseURL', 'http://127.0.0.1:11434/v1'], ['model', 'qwen2.5:7b'], ['role', 'both']]);
  r.mark('⑤ 本地推理同样支持：Ollama / LM Studio / vLLM');
  await r.wait(2100);
  r.mark('⑥ 内网可用、数据不出院；云端与本地可并存');
  await r.wait(1800);
  await r.click('#v-ai .ai-mrow .btn', { after: 900 });
  r.mark('⑦ 逐条「测试」：连通性与 Key 一次校验');
  await r.wait(2200);
  r.mark('⑧ 按用途分配：对话 / 视觉（AI 识别）/ 两者兼用');
  await r.wait(1800);
  await js(`(function(){ const b=[...document.querySelectorAll('#v-ai .cbtns .btn')].find(x=>/保存配置/.test(x.textContent)); if(b) b.click(); return 1; })()`);
  await r.wait(1600);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景：框选采集 → 自动跳转面板（同尺寸换窗续录，一条时间轴） ----------
const BG_HIS = 'C:/Users/Administrator/WorkBuddy/2026-09-09-10-13-42/tcm-competition/demo-shots/bg.png';
function hisBgDataUrl() {
  return 'data:image/png;base64,' + fs.readFileSync(BG_HIS).toString('base64');
}

const RX_REGION_TEXT = [
  '门诊处方',
  '桃仁 12g    红花 9g    当归 9g',
  '生地黄 9g   川芎 5g    赤芍 6g',
  '牛膝 9g     桔梗 5g    柴胡 3g',
  '枳壳 6g     甘草 3g',
  '',
  '用法：7剂，日一剂，水煎400ml，早晚分服',
].join('\n');

async function sceneRegionPanel() {
  const DB = require('./db');
  // 清掉上次录制留下的演示记录，避免重复堆积
  try { DB.recList().filter(x => String(x.id || '').startsWith('recdemo-region-')).forEach(x => DB.recRemove(x.id)); } catch (e) { /* ignore */ }

  // A 段：真实遮罩页框选（overlay.html 在主进程内加载，IPC 全部真实）
  const win = await openWin('overlay.html', 1280, 800, { transparent: true });
  const r = new Recorder('02-框选采集', win, 10);
  win.webContents.send('overlay:bg', hisBgDataUrl());
  await r.until(`!document.body.classList.contains('pre')`, 8000);
  await sleep(500);
  await r.start();
  r.mark('① 唤起框选：HIS 界面被冻结为底图');
  await r.wait(1200);
  r.mark('② 按住鼠标拖拽，框住处方区域');
  // 处方卡片在底图 (139,623)-(1499,822) → 窗口 CSS (92,462)-(1000,609)（1280×800 / 拉伸铺满口径）
  await r.mouseAt('mousedown', 110, 470);
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const x = 110 + Math.round((880 - 110) * i / steps) + (i % 3 === 2 ? 6 : 0);
    const y = 470 + Math.round((600 - 470) * i / steps) + (i % 4 === 1 ? 5 : 0);
    await r.mouseAt('mousemove', x, y);
    await sleep(85);
  }
  await r.mouseAt('mouseup', 880, 600);
  await r.wait(600);
  r.mark('③ 8 个把手可微调选区，工具条自动贴边');
  await r.wait(1500);
  r.mark('④ 点「提交」→ 自动跳转记录面板');
  await r.spot(`#bar .tb[data-k="ok"]`, { after: 500 });

  // 落库一条「刚采集」的记录（未分析），面板刷新即可见
  const rid = 'recdemo-region-' + Date.now().toString(36);
  DB.recAdd({ id: rid, ts: new Date().toISOString(), source: 'region',
    diag: '胸痹', synd: '气滞血瘀证', text: RX_REGION_TEXT,
    patient: '王某', dept: '心病科' });

  // B 段：换窗到真实面板（同 CSS 尺寸，帧无缝衔接）
  // 坑：r.until 轮询的是当前录制窗（此刻还是遮罩页），永远查不到面板里的记录，
  // 会白等两个超时（约 25 秒冻结画面，成片里像「点了提交没反应」）。
  // 必须直接轮询 pwin 本身，记录一出现立刻 swap。
  const pwin = await openWin('panel.html', 1280, 800);
  await pwin.webContents.executeJavaScript(`(async () => { cur = null; await refresh(); return 1; })()`);
  const found = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      try { if (await pwin.webContents.executeJavaScript(`!!document.querySelector('.rec[data-id="${rid}"]')`)) return true; } catch (e) { /* ignore */ }
      await sleep(120);
    }
    return false;
  })();
  log('panel record visible = ' + found);
  await sleep(300);
  r.swap(pwin);
  win.destroy();

  r.mark('⑤ 处方文本已入库 · 本地 OCR 识别中');
  const prog = (pct, label) => pwin.webContents.send('cap:progress', { pct, label });
  const forceShow = () => pwin.webContents.executeJavaScript(
    `(function(){ const el=document.getElementById('capProg'); if(el) el.style.display='flex'; return 1; })()`);
  prog(10, '正在读取选区文本…'); await forceShow();
  await r.wait(700);
  prog(42, 'OCR 识别处方文本…'); await r.wait(800);
  r.mark('⑥ 智能纠正药名与剂量 · 辨证审方引擎…');
  prog(72, '智能纠正药名与剂量…'); await r.wait(800);
  prog(92, '辨证 · 方剂反查 · 审方引擎…'); await r.wait(800);
  prog(100, '完成');
  await pwin.webContents.executeJavaScript(`(function(){ if (typeof hideCapProgress==='function') hideCapProgress(); return 1; })()`);
  await r.wait(500);

  // 打开新记录并现场本地分析（真实引擎）
  r.mark('⑦ 打开新记录：一键本地分析（真实引擎）');
  await r.click(`.rec[data-id="${rid}"]`, { after: 1100 });
  await pwin.webContents.executeJavaScript(`(function(){ if (typeof wbRunLocal==='function') { wbRunLocal(); return 1; } return 0; })()`);
  const ok = await r.until(`document.querySelector('.tcm')`, 45000);
  log('region-panel analysis done = ' + ok);
  r.mark('⑧ 解析完成：逐味药 · 辨证 · 审方结果');
  await r.wait(1800);
  await r.scroll('#main', 360, 700);
  r.mark('全程离线：识别 → 解析 → 审方，数据不出本机');
  await r.wait(1800);

  const meta = await r.stop();
  meta.bg = 'his';   // A 段透明遮罩需要垫 HIS 底图（B 段面板不透明，自动覆盖）
  // Recorder.stop() 在此之前已写 meta.json，补写带 bg 的版本
  try { fs.writeFileSync(path.join(OUT, meta.name, 'meta.json'), JSON.stringify(meta, null, 1)); } catch (e) { /* ignore */ }
  win.destroy(); pwin.destroy();
  return meta;
}

// ---------- 演示数据播种：AI 补库队列 / 纠错自定义规则（只在隔离数据副本上做） ----------
function seedFixDemo() {
  try {
    const DB = require('./db');
    const now = Date.now(), day = 86400000;
    // 补库队列：保留真实历史 done 行 + 3 条 pending（海枫藤=形近错字 / 藤梨根=库外真药 / 水煎内服=噪声）
    const old = DB.kbLoad('unmatched') || [];
    const keep = old.filter(x => x.status !== 'pending' && x.name !== '海枫藤' && x.name !== '藤梨根');
    const rows = keep.concat([
      { id: 'un-rec-seed-1', name: '海枫藤', count: 7, first: now - 6 * day, last: now - day, status: 'pending', source: 'region' },
      { id: 'un-rec-seed-2', name: '藤梨根', count: 3, first: now - 4 * day, last: now - 2 * day, status: 'pending', source: 'paste' },
      { id: 'un-rec-seed-3', name: '水煎内服', count: 4, first: now - 9 * day, last: now - day, status: 'pending', source: 'region' },
    ]);
    DB.kbSave('unmatched', rows);
    // 纠错自定义规则：去掉演示要新增的两条（保证重录一致）
    const fixes = (DB.kbLoad('ocrfix') || []).filter(x => x.w !== '泽夕' && x.w !== '海枫藤');
    DB.kbSave('ocrfix', fixes);
    // userKb 是内存态（启动时快照），播种后必须热重载，否则 IPC 读到旧队列
    try { if (global.__userKb) global.__userKb.loadFromDisk(); } catch (e) { /* 忽略 */ }
    log('seed ok: unmatched=' + rows.length + ' ocrfix=' + fixes.length);
  } catch (e) { log('seed ERR: ' + e.message); }
}

// ---------- 场景 14a：文字纠错（后台） ----------
async function sceneOcrFix() {
  seedFixDemo();
  const win = await openWin('admin.html', 1240, 800);
  const r = new Recorder('14a-文字纠错', win, 10);
  const js = r.js;
  await sleep(900);
  await r.start();
  r.mark('① 后台管理 → 文字纠错：OCR 错字规则库');
  await js(`switchView('ocrfix'); ocrFixInit(true); "ok"`);
  await r.until(`document.querySelector('#ofBuiltin table tbody tr')`, 15000);
  await r.wait(1600);
  r.mark('② 内置规则库：高频形近错字（获苓→茯苓 / 勾藤→钩藤…）');
  await r.wait(1900);
  await r.scroll('#v-ocrfix .imp', 250, 700);
  r.mark('③ 纠错测试：粘一段带错字的识别原文');
  await r.type('#ofTest', '太子参15g　获苓块12g　勾藤10g　川穹9g', 60);
  await r.wait(600);
  await r.click('#v-ocrfix button[onclick="ocrFixTry()"]', { after: 300 });
  await r.until(`document.querySelector('#ofTestRes .ok')`, 8000);
  r.mark('④ 实时纠正：错字全部命中正名');
  await r.wait(2100);
  await r.scroll('#v-ocrfix .imp', 260, 700);
  r.mark('⑤ 机构自定义规则：本院 HIS 特有错字随手补');
  await r.type('#ofW', '泽夕', 90);
  await r.type('#ofR', '泽泻', 90);
  await r.wait(400);
  await r.click('#v-ocrfix button[onclick="ocrFixAdd()"]', { after: 300 });
  await r.until(`document.querySelector('#ofRes .ok')`, 8000);
  r.mark('⑥ 规则已保存，新抓取立即生效');
  await r.wait(1800);
  await js(`(function(){ document.getElementById('ofTest').value='白术12g　泽夕12g　炙草6g'; ocrFixTry(); return 1; })()`);
  await r.until(`document.querySelector('#ofTestRes .ok')`, 8000);
  r.mark('⑦ 新规则同步生效：泽夕 → 泽泻');
  await r.wait(2000);
  await r.scroll('#v-ocrfix .imp', 240, 700);
  r.mark('⑧ 内置 + 自定义两级纠错，越用越准');
  await r.wait(1900);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 14b：AI 补库（后台，走真实 IPC + AI mock 节奏） ----------
async function sceneUnmAi() {
  seedFixDemo();
  const win = await openWin('admin.html', 1240, 800);
  const r = new Recorder('14b-AI补库', win, 10);
  const js = r.js;
  await sleep(900);
  await r.start();
  r.mark('① 后台管理 → AI 补库：未匹配药名自动维护');
  await js(`switchView('unm'); unmInit(true); "ok"`);
  await r.until(`document.querySelector('#unmTbl table tbody tr')`, 15000);
  r.mark('② 采集时未匹配到库的药名，自动进入队列');
  await r.wait(2000);
  r.mark('③ 形近错字 / 库外真药 / 噪声，混在一起待判定');
  await r.wait(1800);
  r.mark('④ ✦ AI 一键解析：云端模型逐一比对知识库');
  await js(`(function(){ const b=[...document.querySelectorAll('#v-unm .cbtns .btn')].find(x=>/AI 一键解析/.test(x.textContent)); if(b) b.click(); return 1; })()`);
  await r.until(`document.querySelector('#unmRes') && /AI 正在解析/.test(document.querySelector('#unmRes').textContent)`, 6000);
  await r.wait(2600);
  await r.until(`document.querySelector('#unmRes .ok')`, 30000);
  r.mark('⑤ 判定完成：三类处置自动落库');
  await r.wait(1800);
  await r.scroll('#v-unm .imp', 240, 700);
  r.mark('⑥ 海枫藤 → 形近字，自动加入文字纠错表');
  await r.wait(1900);
  await r.scroll('#v-unm .imp', 240, 700);
  r.mark('⑦ 藤梨根 → 库外真药，补录中药库（AI 生成性味功效，标 AI 待复核）');
  await r.wait(1900);
  r.mark('⑧ 水煎内服 → 识别为用法噪声，自动忽略不入库');
  await r.wait(1800);
  r.mark('⑨ 闭环：纠错表已更新，下张处方自动纠正');
  await js(`switchView('ocrfix'); ocrFixInit(true); "ok"`);
  await r.until(`document.querySelector('#ofUser table tbody tr')`, 15000);
  await r.wait(1200);
  await r.scroll('#v-ocrfix .imp', 480, 700);
  await js(`(function(){ const u=document.getElementById('ofUser'); if(!u) return 0;
    [u, ...u.querySelectorAll('*')].forEach(el => { if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight; });
    return 1; })()`);
  await r.wait(1600);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 15：AI 问药（独立问答窗；AI_MOCK=1 + AI_MOCK_DELAY 出真实里程碑节奏） ----------
async function sceneAiAsk() {
  const win = await openWin('ai.html', 900, 720);
  const r = new Recorder('15-AI问药', win, 10);
  const js = r.js;
  await sleep(600);
  // 演示顶栏模型名（真实环境显示用户实际配置的模型 / 演示模式标记）
  await js(`(function(){ const m=document.getElementById('mdl'); if(m){ m.textContent='模型：DeepSeek · deepseek-chat'; } return 1; })()`);
  await r.start();
  r.mark('① 悬浮球 / 托盘 → AI 问药：辨证 · 点评 · 问答');
  await r.wait(1600);
  r.mark('② 快捷问题一键提问，也可手动输入任意问题');
  await r.click('#quick .q:nth-child(2)', { after: 900 });
  r.mark('③ 本地知识库检索 → 上下文组装 → 云端模型推理');
  await r.until(`document.getElementById('aiProgBar')`, 6000);
  r.mark('④ 推理中…（真实里程碑进度：上下文 / 调用 / 渲染）');
  await r.wait(700);
  const ok1 = await r.until(`!document.getElementById('bubble') && document.querySelectorAll('#msgs .msg.ai').length >= 2`, 30000);
  log('ask1 done = ' + ok1);
  r.mark('⑤ 结构化辨证输出：证据 → 推理链 → 证型 → 治法');
  await r.wait(1700);
  await r.scroll('#msgs', 430, 700);
  r.mark('⑥ 结合本地方剂库给建议：四君子汤 / 六君子汤意');
  await r.wait(2000);
  r.mark('⑦ 追问处方安全：逐味核查 · 配伍禁忌 · 用药教育');
  await r.type('#inp', '这张处方要注意什么？黄芪30g 当归12g 川芎9g 桃仁9g 红花6g', 40);
  await r.click('#send', { after: 800 });
  await r.until(`document.getElementById('aiProgBar')`, 6000);
  const ok2 = await r.until(`!document.getElementById('bubble') && document.querySelectorAll('#msgs .msg.ai').length >= 3`, 30000);
  log('ask2 done = ' + ok2);
  r.mark('⑧ 安全核查：方义 / 剂量 / 禁忌 / 煎服与患者教育');
  await r.wait(1700);
  await r.scroll('#msgs', 400, 700);
  r.mark('⑨ AI 结论仅供辅助，须经执业医师核对');
  await r.wait(2000);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

const SCENES = {
  'rx-analyze': sceneRxAnalyze,
  'rx-review': sceneRxReview,
  'kb-search': sceneKbSearch,
  'dash': sceneDash,
  'dataport': sceneDataport,
  'ai-read': sceneAiRead,
  'yibao-admin': sceneYbAdmin,
  'yibao-warn': sceneYbWarn,
  'ocr-modes': sceneOcrModes,
  'ai-models': sceneAiModels,
  'region-panel': sceneRegionPanel,
  'ocrfix': sceneOcrFix,
  'unm-ai': sceneUnmAi,
  'ai-ask': sceneAiAsk,
  'kb-debug': sceneKbDebug,
};

// 临时调试：知识检索点击链路（复刻完整步骤）
async function sceneKbDebug() {
  const win = await openWin('panel.html', 1100, 720);
  const js = (c) => win.webContents.executeJavaScript(c);
  await js(`(async () => { cur = null; await refresh(); return 1; })()`);
  await sleep(600);
  await js(`(function(){ document.getElementById('btnKb').click(); return 1; })()`);
  await sleep(1200);
  const typeIn = async (text, ms) => {
    await js(`(function(){ const q = document.querySelector('#kbHost .kbs .inp'); q.focus(); q.value=''; return 1; })()`);
    for (const ch of text) {
      await sleep(ms);
      await js(`(function(){ const q = document.querySelector('#kbHost .kbs .inp'); q.value += ${JSON.stringify(ch)};
        q.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    }
  };
  const probe = (tag) => js(`(function(){
    const li = document.querySelector('#kbHost .lbox .li');
    const det = document.querySelector('#kbHost .det');
    return JSON.stringify({ tag: ${JSON.stringify('')}, first: li && li.dataset.n,
      det: det ? det.textContent.replace(/\\s+/g, ' ').slice(0, 40) : 'none' });
  })()`).then(s => console.log('[dbg]', s));
  await typeIn('丹参', 130); await sleep(900);
  await probe('after-type-danshen');
  await js(`(function(){ const it = document.querySelector('#kbHost .lbox .li'); if (it) { it.scrollIntoView({block:'nearest'}); it.click(); } return 1; })()`);
  await sleep(1600); await probe('after-click-1');
  await js(`(function(){ const b = document.querySelector('#kbHost .fs button[data-k="f"]'); if (b) b.click(); return 1; })()`);
  await sleep(600); await probe('after-tab-f');
  await typeIn('血府逐瘀', 110); await sleep(900);
  await probe('after-type-xfzy');
  await js(`(function(){ const it = document.querySelector('#kbHost .lbox .li'); if (it) { it.scrollIntoView({block:'nearest'}); it.click(); } return 1; })()`);
  await sleep(1400); await probe('after-click-2');
  await sleep(2000); await probe('final');
  win.destroy();
  return null;
}

// ---------- 场景 2：处方点评工作台（后台） ----------
async function sceneRxReview() {
  const win = await openWin('admin.html', 1240, 800);
  const r = new Recorder('05-处方点评工作台', win, 10);
  const js = r.js;
  await sleep(1200);
  await r.start();
  r.mark('① 后台管理 → 处方点评工作台');
  await js(`switchView('rxreview'); rxReviewInit(); "ok"`);
  await r.until(`document.querySelector('#rxGauge') && document.querySelector('#rxGauge').innerHTML.length > 40`, 30000);
  r.mark('② 批量点评：不规范 / 不适宜 / 超常 三分类');
  await r.wait(2000);
  r.mark('③ 点评仪表盘：合理率 · 平均评分 · 医保/配伍提示');
  await r.wait(1600);
  await r.scroll('#v-rxreview', 520, 800);
  r.mark('④ 月度统计与问题分布（点击月份下钻）');
  await r.wait(1800);
  await r.scroll('#v-rxreview', 480, 800);
  r.mark('⑤ 问题处方明细：逐张列出扣分项');
  await r.wait(1800);
  await r.js(`(function(){ const s = document.getElementById('rxClsSel'); if (s) { s.value = 'inappropriate'; if (typeof rxRenderAll === 'function') rxRenderAll(); } return 1; })()`);
  r.mark('⑥ 筛选：仅看「用药不适宜」处方');
  await r.wait(2200);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 3：知识库检索（面板） ----------
async function sceneKbSearch() {
  const win = await openWin('panel.html', 1100, 720);
  const r = new Recorder('06-知识检索', win, 10);
  const js = r.js;
  await js(`(async () => { cur = null; await refresh(); return 1; })()`);
  await sleep(700);
  await r.start();
  r.mark('① 记录面板 → 知识检索');
  await r.click('#btnKb', { after: 1200 });
  r.mark('② 中药检索：名称 / 别名 / 功效 / 拼音');
  await r.js(`(function(){ const b = document.querySelector('#kbHost .fs button[data-k="h"]'); if (b) b.click(); return 1; })()`);
  await r.type('#kbHost .kbs .inp', '丹参', 130);
  await r.wait(900);
  r.mark('③ 命中「丹参」→ 打开中药详情');
  await r.js(`(function(){ const it = document.querySelector('#kbHost .lbox .li'); if (it) { it.scrollIntoView({ block: 'nearest' }); it.click(); } return 1; })()`);
  await r.wait(1500);
  r.mark('④ 药性 · 功效 · 用法 · 医保支付类别');
  await r.wait(1800);
  r.mark('⑤ 切换方剂检索：血府逐瘀汤');
  await r.js(`(function(){ const b = document.querySelector('#kbHost .fs button[data-k="f"]'); if (b) b.click(); return 1; })()`);
  await r.type('#kbHost .kbs .inp', '血府逐瘀', 110);
  await r.wait(900);
  await r.js(`(function(){ const it = document.querySelector('#kbHost .lbox .li'); if (it) { it.scrollIntoView({ block: 'nearest' }); it.click(); } return 1; })()`);
  await r.wait(1500);
  r.mark('⑥ 方剂出处 · 主治证型 · 配伍组成');
  await r.wait(2200);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 4：数据看板（面板） ----------
async function sceneDash() {
  const win = await openWin('panel.html', 1100, 720);
  const r = new Recorder('07-数据看板', win, 10);
  const js = r.js;
  await js(`(async () => { cur = null; await refresh(); return 1; })()`);
  await sleep(700);
  await r.start();
  r.mark('① 记录面板 → 数据看板');
  await r.js(`showDash(); "ok"`);
  await r.wait(1500);
  r.mark('② 采集总量 · 科室分布 · 合规概览');
  await r.wait(1800);
  await r.scroll('#main', 430, 800);
  r.mark('③ 识别来源 / 审方告警趋势');
  await r.wait(1800);
  await r.scroll('#main', 430, 800);
  r.mark('④ 科室下钻：按科室统计');
  await r.wait(2000);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

// ---------- 场景 5：数据搬家（后台 · 系统设置） ----------
async function sceneDataport() {
  const win = await openWin('admin.html', 1240, 800);
  const r = new Recorder('08-数据搬家', win, 10);
  const js = r.js;
  await sleep(1200);
  await r.start();
  r.mark('① 后台管理 → 系统设置 → 数据搬家');
  await js(`switchView('sys'); sysInit(); "ok"`);
  await r.until(`document.querySelector('#mvAudit') && document.querySelector('#mvAudit').textContent.indexOf('审计') === -1`, 15000);
  r.mark('② 配置全部入库审计：设置 / 知识库 / 标准库');
  await r.wait(1800);
  await r.scroll('#v-sys .imp', 430, 800);
  r.mark('③ data.db 单文件：拷走即搬家，不丢任何配置');
  await r.wait(2000);
  await r.scroll('#v-sys .imp', 430, 800);
  r.mark('④ 导出配置包(.qhcfg) / 导入 / 整库导出');
  await r.wait(2200);
  const meta = await r.stop();
  win.destroy();
  return meta;
}

async function run() {
  log('=== rec-gif start ===');
  const arg = (process.argv.find(a => a.startsWith('--rec-gif=')) || '').split('=')[1] || '';
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
  const names = (only || arg || Object.keys(SCENES).join(',')).split(',').filter(Boolean).map(s => s.trim());
  for (const n of names) {
    const fn = SCENES[n];
    if (!fn) { log('unknown scene ' + n); continue; }
    try { const m = await fn(); log('scene ' + n + ' -> ' + JSON.stringify({ frames: m.frames, w: m.w, h: m.h, marks: m.marks.length })); }
    catch (e) { log('scene ' + n + ' ERR ' + (e && e.stack || e)); }
  }
  log('=== rec-gif done ===');
  try { const DB = require('./db'); DB.checkpoint && DB.checkpoint(); } catch (e) { /* ignore */ }
  await sleep(300);
  app.exit(0);
}

module.exports = { run, SCENES };
