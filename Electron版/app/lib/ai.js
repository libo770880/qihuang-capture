// lib/ai.js - 岐黄鉴方 AI 智能层（云端大模型 · OpenAI 兼容协议）
// 纯本地规则引擎负责即时结果；本模块按需调用云端 LLM 做“人话解读 / 辨证推理 / 处方点评 / 知识问答”。
// 无 key / 无网络 / --ai-mock 时自动返回可预期的降级内容，保证演示与 UI 链路可自测。
const fs = require('fs');
const path = require('path');
const KB = require('./kb');
const rag = require('./rag');

const IS_MOCK = process.env.AI_MOCK === '1' || process.argv.includes('--ai-mock');

const AI_PROVIDERS = {
  deepseek: { label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  moonshot: { label: 'Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  qwen: { label: '通义千问（阿里云百炼）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  zhipu: { label: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  custom: { label: '自定义（OpenAI 兼容）', baseURL: '', model: '' }
};

const DEFAULTS = { temperature: 0.4, models: [], chatId: '', visionId: '', mock: false, stripRules: '' };

// 各服务商默认视觉模型名（仅供后台界面提示；DeepSeek 无视觉接口）
const VISION_MODEL = {
  qwen: 'qwen-vl-max-latest',
  zhipu: 'glm-4v-flash',
  moonshot: 'moonshot-v1-8k-vision-preview',
  deepseek: null,
  custom: ''
};

const ROLE = [
  '你是「岐黄鉴方」，一名中医执业级审方与病历内涵质控助手，服务于医院中医临床与病案质控场景。',
  '回答要求：',
  '1. 始终基于给到的病历/处方/知识库上下文作答，不编造依据；知识库未收录时明确说“本地库未收录，建议人工核对权威典籍”。',
  '2. 使用简体中文，输出 Markdown，善用 加粗、短段落、要点列表；涉及正文引用时给出出处（如《伤寒论》）。',
  '3. 辨证推理须展示证据链（症状 → 舌脉/体征 → 证型 → 治法 → 方剂），不要直接跳结论。',
  '4. 你提供的仅是基于规则与知识的辅助参考，不等同于执业诊断与处方；结尾保留一句：本内容由 AI 生成，仅供学习参考，需经执业医师核对。',
  '5. 输入文本均已做脱敏，禁止复述或推断其中可能的姓名、证件、电话等个人隐私内容。'
].join('\n');

let cfgDir = null;
let cfg = JSON.parse(JSON.stringify(DEFAULTS));

// ---------- 配置（多模型列表）----------
// cfg.models: [{id, label, baseURL, apiKey, model, role}] role: chat=对话 | vision=视觉(AI识别) | both | ''
// cfg.chatId / cfg.visionId：当前生效的对话/视觉模型条目 id
function initAi(userDataDir) {
  cfgDir = path.join(userDataDir, 'config'); // 仅保留目录供迁移判断/兼容
  try { fs.mkdirSync(cfgDir, { recursive: true }); } catch (e) { /* ignore */ }
  // 配置存于 SQLite data.db 的 kv 表（k='ai'；db.migrateJson 首启已从旧 config/ai.json 迁入）
  try {
    const DB = require('./db');
    const stored = DB.kvGet('ai');
    // 深拷贝：cfg 绝不能与 kv 缓存里的对象共享引用，否则内存态改动会顺着引用污染"原始配置"，
    // 让"改完再还原"的写法（探针/临时切换场景）还原出一个已经被改过的值
    if (stored && typeof stored === 'object') Object.assign(cfg, JSON.parse(JSON.stringify(stored)));
  } catch (e) { /* use default */ }
  migrateCfg();
  return api;
}
/** 旧版单模型配置（provider/baseURL/apiKey/model/visionModel）→ 迁移为模型列表 */
function migrateCfg() {
  if (!Array.isArray(cfg.models)) cfg.models = [];
  if (!cfg.models.length) {
    const p = AI_PROVIDERS[cfg.provider] || {};
    const first = {
      id: 'm' + Date.now(),
      label: p.label || cfg.provider || '默认模型',
      baseURL: cfg.baseURL || p.baseURL || '',
      apiKey: cfg.apiKey || '',
      model: cfg.model || p.model || '',
      role: 'chat'
    };
    cfg.models = [first];
    cfg.chatId = first.id;
    if (cfg.visionModel) {
      const v = { id: 'm' + (Date.now() + 1), label: '视觉模型', baseURL: first.baseURL, apiKey: first.apiKey, model: cfg.visionModel, role: 'vision' };
      cfg.models.push(v);
      cfg.visionId = v.id;
    }
  }
  if (!cfg.models.find(m => m.id === cfg.chatId)) cfg.chatId = (cfg.models.find(m => m.role === 'chat' || m.role === 'both') || cfg.models[0] || {}).id || '';
  if (!cfg.models.find(m => m.id === cfg.visionId)) cfg.visionId = (cfg.models.find(m => m.role === 'vision' || m.role === 'both') || {}).id || '';
}
function saveCfg() {
  if (!cfgDir) return;
  try { require('./db').kvSet('ai', cfg); } catch (e) { /* ignore */ }
}
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '********';
  return k.slice(0, 4) + '****' + k.slice(-4);
}
function entryPub(m) {
  return { id: m.id, label: m.label, baseURL: m.baseURL, model: m.model, role: m.role || '',
    apiKey: m.apiKey ? maskKey(m.apiKey) : '', hasKey: !!m.apiKey };
}
function publicCfg() {
  return {
    mock: IS_MOCK || !!cfg.mock, temperature: cfg.temperature,
    models: cfg.models.map(entryPub), chatId: cfg.chatId, visionId: cfg.visionId,
    stripRules: String(cfg.stripRules || ''),
    hasKey: ready(), modelLabel: modelLabel(), visionReady: visionReady(), visionLabel: visionModelLabel()
  };
}
function updateCfg(patch) {
  if (!patch) return publicCfg();
  if (patch.temperature !== undefined) cfg.temperature = Number(patch.temperature) || 0.4;
  if (patch.mock !== undefined) cfg.mock = !!patch.mock;
  if (Array.isArray(patch.models)) {
    const prevById = {};
    cfg.models.forEach(m => { prevById[m.id] = m; });
    cfg.models = patch.models.map(m => {
      const prev = prevById[m.id];
      const key = String(m.apiKey || '').trim();
      return {
        id: String(m.id || ('m' + Date.now() + Math.random().toString(36).slice(2, 6))),
        label: String(m.label || '').trim() || '模型',
        baseURL: String(m.baseURL || '').trim(),
        model: String(m.model || '').trim(),
        role: ['chat', 'vision', 'both', ''].indexOf(m.role) >= 0 ? m.role : '',
        // 界面回传打码值/留空时不覆盖已存 Key；新条目按原值保存
        apiKey: (prev && (!key || key.indexOf('****') >= 0)) ? prev.apiKey : key
      };
    });
  }
  if ('chatId' in patch) cfg.chatId = String(patch.chatId || '');
  if ('visionId' in patch) cfg.visionId = String(patch.visionId || '');
  if (patch.stripRules !== undefined) cfg.stripRules = String(patch.stripRules || '').slice(0, 4000);
  // 引用失效兜底：按 role 回退
  if (!cfg.models.find(m => m.id === cfg.chatId)) cfg.chatId = (cfg.models.find(m => m.role === 'chat' || m.role === 'both') || cfg.models[0] || {}).id || '';
  if (!cfg.models.find(m => m.id === cfg.visionId)) cfg.visionId = (cfg.models.find(m => m.role === 'vision' || m.role === 'both') || {}).id || '';
  saveCfg();
  return publicCfg();
}

// ---------- 底层调用 ----------
function chatEntry() { return cfg.models.find(m => m.id === cfg.chatId) || null; }
function visionEntry() { return cfg.models.find(m => m.id === cfg.visionId) || null; }
function endpoint(entry) {
  const e = entry || chatEntry() || {};
  let b = String(e.baseURL || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  return /\/chat\/completions$/i.test(b) ? b : b + '/chat/completions';
}
function ready() {
  if (IS_MOCK) return true;
  const c = chatEntry();
  return !!(c && c.apiKey && endpoint(c));
}
function chat(systemText, userText, opt = {}) {
  if (!ready()) {
    const e = new Error('未配置云端模型：请在 后台管理 → AI 设置 中填写 API Key（或使用 --ai-mock 自测模式）');
    e.code = 'NO_KEY';
    return Promise.reject(e);
  }
  const messages = [];
  if (systemText) messages.push({ role: 'system', content: systemText });
  messages.push({ role: 'user', content: userText });
  return callChat(messages, opt);
}
// 带自动续写的对话：撞到 max_tokens 截断（finish_reason=length）时，携带已生成内容请求无缝续写并拼接
async function chatContinue(systemText, userText, opt = {}) {
  const contMax = opt.continueMax !== undefined ? opt.continueMax : 2;
  // 进度上报：只报真实里程碑（第几段请求 / 第几段返回），不编造百分比爬升。
  const onStage = typeof opt.onStage === 'function' ? opt.onStage : null;
  const stage = (s, r) => { if (onStage) { try { onStage({ stage: s, round: r }); } catch (e) { /* 进度上报失败不影响主流程 */ } } };
  const messages = [];
  if (systemText) messages.push({ role: 'system', content: systemText });
  messages.push({ role: 'user', content: userText });
  stage('request', 1);
  const first = await callChat(messages, opt);
  stage('round', 1);
  let content = first.content || '';
  let finish = first.finish;
  let n = 0;
  messages.push({ role: 'assistant', content });
  while (finish === 'length' && n < contMax) {
    messages.push({ role: 'user', content: '上面的输出因长度限制被截断。请从中断处无缝续写剩余内容：不要重复任何已输出内容，不要寒暄或重新开头，直接接着写；若已写完则只回复「（完）」。' });
    stage('request', n + 2);
    const cont = await callChat(messages, opt);
    stage('round', n + 2);
    let piece = (cont.content || '').trim();
    if (piece === '（完）' || !piece) break;
    // 去掉续写端可能的重复开头（续写有时会重写最后一个小标题）
    content = joinContinue(content, piece);
    messages.push({ role: 'assistant', content: piece });
    finish = cont.finish;
    n++;
  }
  return { content, model: first.model, usage: first.usage, finish, continued: n > 0 };
}
// 拼接续写片段：若片段开头重复了主文最后一行（续写常会重写最后一个小标题），则去掉重复部分
function joinContinue(main, piece) {
  let p = piece.trim();
  const tails = String(main).split('\n').map(s => s.trim()).filter(Boolean);
  const last = tails[tails.length - 1] || '';
  if (last && p.startsWith(last)) p = p.slice(last.length).replace(/^\s*[:：]?\s*/, '');
  const seam = /[-—:：、)\）》]\s*$/.test(String(main)) ? '' : '\n';
  return main + seam + p;
}
/** 各服务商/模型的 max_tokens 上限（超限会被直接 400 拒收，如 glm-4v* 系列限制 [1,1024]） */
function maxTokensCap(model) {
  const m = String(model || '').toLowerCase();
  if (/^glm-4v/.test(m)) return 1024;
  return 4096;
}
// 演示模式节奏：真实云端模型有网络往返，mock 默认瞬时返回会让「生成中」进度条一闪而过。
// 仅演示/录制用（AI_MOCK_DELAY 毫秒，默认 0，不影响正常逻辑）。
const MOCK_DELAY = Math.max(0, Number(process.env.AI_MOCK_DELAY || 0)) || 0;
function callChat(messages, opt = {}) {
  if (IS_MOCK) {
    const last = messages[messages.length - 1] || {};
    const payload = { mock: true, content: mockReply(last.content || '') };
    if (!MOCK_DELAY) return Promise.resolve(payload);
    return new Promise(r => setTimeout(() => r(payload), MOCK_DELAY));
  }
  const entry = opt.entry || chatEntry();
  if (!entry || !entry.apiKey || !endpoint(entry)) {
    return Promise.reject(Object.assign(new Error('未配置云端模型：请在 后台管理 → AI 设置 中添加模型并填写 API Key'), { code: 'NO_KEY' }));
  }
  const url = endpoint(entry);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opt.timeout || 90000);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + entry.apiKey
    },
    body: JSON.stringify({
      model: opt.modelOverride || entry.model,
      messages,
      temperature: opt.temperature !== undefined ? opt.temperature : cfg.temperature,
      // 各模型 max_tokens 上限不同（glm-4v* 系列为 1024，超限直接 400）：按模型收敛到安全值
      max_tokens: Math.min(opt.maxTokens || 1600, maxTokensCap(opt.modelOverride || entry.model)),
      stream: false
    }),
    signal: ctrl.signal
  }).then(async (res) => {
    clearTimeout(timer);
    const body = await res.text();
    if (!res.ok) {
      let msg = body;
      try { msg = JSON.parse(body).error && (JSON.parse(body).error.message || msg); } catch (e) { /* raw */ }
      const err = new Error('模型接口错误 ' + res.status + '：' + msg);
      err.code = 'HTTP_' + res.status;
      throw err;
    }
    try {
      const j = JSON.parse(body);
      const ch = j.choices && j.choices[0];
      const c = ch && ch.message;
      if (!c || !c.content) {
        // 空内容：带上 finish_reason/模型名/原始返回片段，便于定位（内容过滤/长度截断/参数问题）
        throw new Error('返回内容为空（finish=' + ((ch && ch.finish_reason) || '-') + '，模型=' + (j.model || entry.model) + '，返回=' + body.slice(0, 160) + '）');
      }
      return { content: c.content, model: j.model || entry.model, usage: j.usage, finish: ch.finish_reason || '' };
    } catch (e) {
      if (/返回内容为空/.test(e.message)) throw e; // 已带诊断信息，不再包一层
      throw new Error('解析模型返回失败：' + e.message);
    }
  }).catch((e) => {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') {
      const err = new Error('请求超时（' + Math.round((opt.timeout || 90000) / 1000) + 's），请检查网络或更换模型');
      err.code = 'TIMEOUT';
      throw err;
    }
    if (e && e.code) throw e;
    const err = new Error('无法连接模型服务：' + e.message);
    err.code = 'NET';
    throw err;
  });
}

// ---------- AI 识别（视觉大模型 OCR，走独立的「视觉」模型条目）----------
function visionModelLabel() {
  if (IS_MOCK) return '演示模式';
  const e = visionEntry();
  return e ? ((e.label ? e.label + ' · ' : '') + (e.model || '未填模型名')) : '';
}
function visionReady() {
  if (IS_MOCK) return true;
  const e = visionEntry();
  return !!(e && e.apiKey && endpoint(e) && e.model);
}
// ---------- AI 识别剔除规则（后台「AI 设置」可配置，存 ai.json.stripRules） ----------
// 规则逐行一条：普通行=行内剔除该片段；/正则/=按正则剔除片段；~开头=匹配的整行剔除；#开头=注释
// 解析与执行的唯一实现在 renderer/strip-rules.js（后台页面「试一试」预览共用同一份），此处只做缓存。
const StripRules = require('../renderer/strip-rules');
let _stripCache = { src: null, drop: [], cut: [] };
function stripRuleLists() {
  const src = String(cfg.stripRules || '');
  if (_stripCache.src === src) return _stripCache;
  const p = StripRules.parse(src);
  _stripCache = { src, drop: p.drop, cut: p.cut };
  return _stripCache;
}
/** 对 AI 视觉转录结果（lines）应用剔除规则；剔除后为空的行整行丢弃。
 *  执行逻辑同 renderer/strip-rules.js（后台「试一试」预览与此处完全一致）。 */
function applyStripRules(lines) {
  return StripRules.apply(lines, cfg.stripRules);
}

/**
 * 视觉大模型转录截图文字（OpenAI 兼容 image_url 协议，通义/智谱/Kimi 均支持）。
 * 返回 {ok, engine, lines:[{text}], text, model}，结构与本地 OCR 一致，调用方可复用 linesToText/纠错管线。
 */
async function visionOcr(imagePath, opt = {}) {
  if (IS_MOCK) {
    const demo = '主诉：反复上腹隐痛3月，加重1周。\n诊断：脾胃虚寒证\n处方：\n黄芪 15g\n太子参 12g\n白术 10g\n茯苓 12g\n姜厚朴 9g\n炙甘草 6g';
    return { ok: true, engine: 'ai-vision', model: 'mock', mock: true, lines: demo.split('\n').map(t => ({ text: t })), text: demo };
  }
  const entry = visionEntry();
  if (!entry || !entry.apiKey || !endpoint(entry) || !entry.model) {
    throw new Error('未配置视觉模型：请在 后台管理 → AI 设置 添加一个支持看图的模型（如 qwen-vl-max-latest、glm-4v-flash）并标记用途为「视觉」');
  }
  // 已知纯文本模型预检：提前报错，省一次注定 400 的请求
  const m = String(entry.model).toLowerCase();
  const textOnly =
    /^glm-4(?!v)/.test(m) ||                 // glm-4-flash / glm-4-air / glm-4-plus（glm-4v* 才能看图）
    /^deepseek/.test(m) ||
    /^qwen(?!.+-?vl)/.test(m) ||             // qwen-plus / qwen-max（qwen-vl* 才能看图）
    /^moonshot-v1-\d+k$/.test(m);            // moonshot-v1-8k（-vision 后缀才能看图）
  if (textOnly) {
    throw new Error('「视觉」条目配置的是纯文本模型（' + entry.model + '），无法识别图片。请改用视觉模型：智谱填 glm-4v-flash（免费）、通义填 qwen-vl-max-latest、Kimi 填 moonshot-v1-8k-vision-preview');
  }
  const b64 = fs.readFileSync(imagePath).toString('base64');
  const dataUrl = 'data:image/png;base64,' + b64;
  const messages = [
    { role: 'system', content: [
      '你是医疗处方/病历截图的专业文字转录引擎（OCR）。转录要求：',
      '1. 逐行转录图片中的全部正文文字，严格保持原图行序与内容，不遗漏、不改写、不翻译、不纠正、不补全；',
      '2. 看不清/模糊/被遮挡的字符用「□」占位——严禁根据医学常识猜测或编造文字，尤其禁止把看不清的行想象成动物药（蜈蚣、蜘蛛、全蝎等）；图里没有的行一行都不能多；',
      '3. 中药名、剂量、诊断、症状等保持原文写法（如「姜半夏 9g」「法半夏10g」照抄）；',
      '4. 界面控件文字、按钮、水印、页眉页脚、窗口标题栏等非正文内容一律跳过；',
      '5. 只输出转录文本本身：不要解释、不要标题、不要 Markdown 包装、不要免责声明。'
    ].join('\n') },
    { role: 'user', content: [
      { type: 'image_url', image_url: { url: dataUrl } },
      // 格式示例约束（实测有效）：glm-4v 等轻量视觉模型对"跳过 X 列"的抽象指令容易把剂量列一起丢掉，
      // 给出具体的输出格式示例后，药名+剂量转录完整且稳定
      { type: 'text', text: '请逐行转录这张截图中的全部正文文字。如果是中药处方表格，输出每味药的「药名 剂量」两列，格式示例：\n党参 20g\n茯神 30g\n忽略规格列(如 1克*1g/g)和对勾✓符号，只输出「药名 剂量」行。' }
    ] }
  ];
  let r;
  try {
    r = await callChat(messages, { entry, temperature: 0.1, maxTokens: 2000, timeout: opt.timeout || 120000 });
  } catch (e) {
    // 服务商拒收 image_url：典型原因是「视觉」条目填了纯文本模型（如 DeepSeek）或接口地址配错
    if ((e.code === 'HTTP_400' || e.code === 'HTTP_422') && /content|type|image/i.test(e.message || '')) {
      throw new Error('该模型/接口不支持看图（content.type 仅允许 text）：请在 后台管理 → AI 设置 检查标记为「视觉」的条目，模型名须为视觉模型（如 qwen-vl-max-latest、glm-4v-flash），且接口地址属于该视觉模型的服务商');
    }
    throw e;
  }
  const text = String(r.content || '').trim()
    .replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '') // 模型偶尔包 ``` 代码块，剥掉
    .trim();
  // 二次自核：把首轮转录连同原图再发一次，让模型逐行对照图片删掉多写/编造的行、补回漏行。
  // 轻量视觉模型（glm-4v-flash 等）对模糊行易幻觉出「蜈蚣 3g 蜘蛛 6g」这类动物药，实测自核可有效回收。
  let ftext = text;
  try {
    const v = await callChat([
      { role: 'system', content: '你是 OCR 质检员。对照图片逐行核对这份转录稿：删掉图片中不存在的行（编造/幻觉），补回漏掉的行，修正错字；与图片一致的行必须原样保留。看不清的字符用「□」占位。只输出核对后的完整转录文本，不要任何解释。' },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: '【转录稿】\n' + text + '\n\n请对照图片核对并输出修正后的完整转录。' }
      ] }
    ], { entry, temperature: 0.1, maxTokens: 2000, timeout: opt.timeout || 120000 });
    const vtext = String(v.content || '').trim().replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim();
    // 自核结果防御：过短/空/翻倍异常时保留首轮
    if (vtext && vtext.length >= Math.max(10, text.length * 0.3) && vtext.length <= text.length * 3 + 200) ftext = vtext;
  } catch (e) { /* 自核失败不阻断，用首轮结果 */ }
  const rawLines = ftext.split('\n').map(s => s.trim()).filter(Boolean).map(t => ({ text: t }));
  const lines = applyStripRules(rawLines); // 后台剔除规则：模型仍漏删的界面噪音在此统一清除
  const ftext2 = lines.map(l => l.text).join('\n');
  return { ok: true, engine: 'ai-vision', model: r.model || entry.model, lines, text: ftext2 };
}

// ---------- 各类能力 Prompt 组装 ----------
function trunc(s, n) { const t = String(s || '').trim().replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n) + '…' : t; }
function herbLine(h) {
  return `- ${h.n}：${h.fx || ''}${h.prop ? '（' + h.prop + '）' : ''}${h.use ? ' 用法' + h.use : ''}`;
}

// ① 病历内涵质控 AI 版：把规则引擎的机器结果“翻译”成医生/质控员易懂话术 + 补充建议
function buildQcPrompt(text, compliance) {
  const parts = ['请对以下【已脱敏病历片段】做内涵质控解读。要求：',
    '## 一、总体评价：一两句话概括文书质量与最大风险点；',
    '## 二、逐条解读：对每条机器质检提示，用医生能懂的话解释“为什么扣分、缺什么”，并给出可直接改写的补全示例；',
    '## 三、改进优先级：按 必须修改 > 建议完善 > 提示 排序给出前三项。',
    '', '【病历片段】', text || '（空）'];
  if (compliance && compliance.hasRecord) {
    parts.push('', '【规则引擎质控结果（得分 ' + (compliance.score ?? '-') + ' · ' + (compliance.grade || '') + '）】');
    (compliance.items || []).slice(0, 12).forEach(it => {
      parts.push(`- [${it.level}] ${it.title}${it.detail ? '：' + it.detail : ''}${it.advice ? ' 建议：' + it.advice : ''}`);
    });
  } else {
    parts.push('', '（规则引擎未判定为完整病历文书，请据实判断是否具备质控要素：主诉、现病史、既往史、诊断依据、治疗计划等）');
  }
  return parts.join('\n');
}

// ② 中医辨证推理链：症状 → 证型 → 治法 → 方剂（可解释证据链）
function buildDialecticPrompt(text, keys) {
  const parts = ['请对以下【四诊/病史片段】做中医辨证推理。要求输出：',
    '## 一、证据提取：列出关键症状与舌脉信息（用列表，标注阴阳/寒热/虚实倾向）；',
    '## 二、辨证推理链：逐条写出 症状 → 病机 → 证型 的推理步骤；',
    '## 三、证型与治法：给出最可能证型 1-2 个及相应治法；',
    '## 四、方剂建议：给出 1-2 首代表方（含出处）并简述组方思路，若与本地知识库检索结果一致可注明“与库内方书一致”。',
    '', '【四诊/病史】', trunc(text, 1500)];
  if (keys && Object.keys(keys).length) {
    parts.push('', '【已抽取要点】' + Object.keys(keys).map(k => k + '：' + keys[k]).join('；'));
  }
  return parts.join('\n');
}

// ③ 处方 AI 点评 + 患者教育
function buildRxPrompt(herbs, rx, usage) {
  const parts = ['请对以下【中药处方】做点评并生成患者教育。要求输出：',
    '## 一、方义解读：按 君臣佐使 拆解各药角色（一行一药）；',
    '## 二、安全性核查：复核剂量是否在常规范围、有无 十八反/十九畏、妊娠禁忌、毒性药风险；',
    '## 三、患者用药教育：用通俗语言说明煎服法、忌口、可能反应与就医指征，供患者阅读。',
    '', '【处方药味】'];
  herbs.forEach(h => { parts.push(herbLine(h)); });
  if (!herbs.length) parts.push('（未能从文本解析出具体药味，请据下方文本尽力提取或说明缺项）');
  // 用法（抓取或医生手填）：患者教育里的煎服法必须与之保持一致，不得另编一套
  if (usage) parts.push('', '【处方用法（已抓取/医生填写）】' + usage, '（患者教育的煎服法请以上述用法为准；缺失项另行说明，不要臆造）');
  if (rx && rx.items && rx.items.length) {
    parts.push('', '【规则引擎合规结果】');
    rx.items.slice(0, 8).forEach(it => parts.push(`- [${it.level}] ${it.title}${it.detail ? '：' + it.detail : ''}`));
  }
  return parts.join('\n');
}

// ④ 知识库 RAG 问答
function buildAskPrompt(question, ctxText) {
  return ['请基于下方【本地知识库检索片段】回答用户问题。',
    '要求：优先采用检索到的条目作答并注明其类型（中药/方剂）与出处；检索片段不足以回答时，如实说明并给出最接近的扩展阅读方向；不要编造未收录的药效与剂量。',
    '', '【本地知识库检索片段】', ctxText || '（无命中）', '',
    '【用户问题】', String(question || '').trim()].join('\n');
}

// ---------- mock 降级内容（UI/链路自测用，结构同真实返回） ----------
function mockReply(text) {
  const t = String(text || '');
  // AI 补库·术语归一化：按演示队列返回可解析的 JSON 数组（仅 AI_MOCK=1 时走到这里）
  if (/待解析药名清单/.test(t)) {
    const seg = t.split('知识库现有中药正名')[0];
    const names = [...seg.matchAll(/^- (.+)$/gm)].map(m => m[1].trim()).filter(Boolean);
    const out = names.map(n => {
      if (n === '海枫藤') return { input: n, corrected: '海风藤', confidence: 0.94, reason: '形近字误识：枫→风；海风藤为库内正名，命中知识库校验' };
      if (n === '藤梨根') return { input: n, corrected: null, confidence: 0.87, reason: '库外真实中药（即猕猴桃根，药典收载），按药典口径补录，供人工复核', newHerb: { name: '藤梨根', nature: '甘、微酸，凉。归肝、脾、胃经。', fx: '清热解毒，祛风除湿，活血消肿。', use: '15～30g。', note: '脾胃虚寒者慎服。' } };
      if (/水煎|日一剂|剂量|内服/.test(n)) return { input: n, corrected: null, newHerb: null, confidence: 0, reason: '非药名：属用法/煎服文字被误拆为药味，建议忽略' };
      return { input: n, corrected: null, newHerb: null, confidence: 0, reason: '依据不足，无法判断，已忽略' };
    });
    return JSON.stringify(out);
  }
  const hasJb = /质控|内涵/.test(t);
  const hasBz = /辨证|四诊/.test(t);
  const hasCf = /处方|药味|点评/.test(t) || /^- .*(克|g|G)/m.test(t);
  const secs = [];
  if (hasJb) secs.push('## 一、总体评价\n主诉与诊断信息基本齐备，核心风险在**主诉过于简短、缺发病诱因与伴随症状**。\n\n## 二、逐条解读\n- **【建议完善】主诉不完整**：现描述未含起病诱因、部位性质与持续时间，质控要求“症状+时间”。示例改写：`反复上腹隐痛3月，进食后加重，伴反酸嗳气。`\n\n## 三、改进优先级\n1. 补齐主诉时间轴与诱因\n2. 完善现病史伴随症状\n3. 明确诊断分型依据');
  if (hasBz) secs.push('## 一、证据提取\n- 乏力、气短、面色少华 → 气虚\n- 纳差、便溏、舌淡苔白 → 脾虚湿停\n\n## 二、辨证推理链\n乏力倦怠 → 脾气亏虚，运化失健 → 湿浊内生、气血生化不足。\n\n## 三、证型与治法\n脾虚气滞证 → **健脾益气、行气化湿**\n\n## 四、方剂建议\n- **四君子汤**（《太平惠民和剂局方》）益气健脾，为治本之方\n- 兼腹胀者合陈皮、半夏（六君子汤意）');
  if (hasCf) secs.push('## 一、方义解读\n- 君：以补气健脾药为主，针对气虚之本\n- 臣：理气化湿药助运，防补而壅滞\n- 佐使：调和诸药、引经\n\n## 二、安全性核查\n未检出十八反/十九畏配伍禁忌；各味剂量均在常规范围；无妊娠禁忌提示。\n\n## 三、患者用药教育\n水煎服，早晚饭后温服；忌生冷油腻；如服后腹胀或便溏加重请复诊调整。');
  if (!secs.length) {
    return '## 回答\n根据本地知识库检索结果，该问题建议先核对以下方向：\n- 若为药性/功效咨询：检索到的中药条目通常含性味归经、功效与注意事项；\n- 若为方剂咨询：检索到的方剂条目含出处、组成、主治与加减法；\n- 检索未命中时，本地库未收录，建议人工核对《中国药典》与《方剂学》权威来源。\n\n本内容由 AI 生成，仅供学习参考，需经执业医师核对。';
  }
  return secs.join('\n\n') + '\n\n> 本内容由 AI 生成，仅供学习参考，需经执业医师核对。';
}

// ---------- 统一入口 ----------
async function runAi(kind, payload = {}, onStage) {
  const k = String(kind || '');
  if (k === 'ask') return runAsk(payload, onStage);
  if (k === 'record') return runRecord(payload, onStage);
  if (k === 'test') return runTest();
  return { ok: false, error: '未知的 AI 能力：' + kind };
}

async function runRecord(payload, onStage) {
  const stage = typeof onStage === 'function' ? onStage : null;
  if (stage) { try { stage({ stage: 'prep', round: 0 }); } catch (e) { /* 忽略 */ } }
  const { text, compliance, tcm } = payload;
  const secs = [];
  if (compliance && compliance.hasRecord) secs.push('质控解读');
  const hasSymptoms = /咳嗽|发热|乏力|头痛|腹痛|失眠|纳差|便溏|便秘|舌|苔|脉|恶寒|汗|呕吐|胃|肿|痛|尿/.test(String(text || ''));
  const isDrug = (tcm && tcm.type === 'drugs') || /(克|g|G)\s*[、，,;；.]|方药|处方/.test(String(text || ''));
  if (hasSymptoms) secs.push('辨证推理');
  if (isDrug) secs.push('处方点评');
  if (!secs.length) secs.push('智能解读');

  // 处方「用法」：抓取或手填的结构化值，作为独立上下文带入（抓不到就不提，不虚构）
  const usage = String(payload.usage || (tcm && tcm.usage) || '').trim();
  const blocks = [];
  if (compliance && compliance.hasRecord) blocks.push('【任务一：病历内涵质控解读】\n' + buildQcPrompt(text, compliance));
  if (hasSymptoms) blocks.push('【任务二：中医辨证推理链】\n' + buildDialecticPrompt(text, payload.keys));
  const herbs = (tcm && tcm.herbs || []).map(n => ({ n, fx: (KB.getHerbMap()[n] || {}).fx || '', prop: (KB.getHerbMap()[n] || {}).prop || '', use: (KB.getHerbMap()[n] || {}).use || '' }));
  if (isDrug) blocks.push('【任务三：处方点评与患者教育】\n' + buildRxPrompt(herbs, tcm && tcm.rx, usage));
  blocks.push('整体要求：三个任务若都出现，请分别用 一级标题 分节输出，节内不再重复免责声明，全文结尾统一写一条免责声明。');

  const sys = ROLE;
  const usr = ['请对以下【已脱敏采集内容】依次完成分析：', '', trunc(String(text || ''), 1800), '', blocks.join('\n\n'), ''].join('\n');
  const r = await chatContinue(sys, usr, { maxTokens: 2600, timeout: 150000, continueMax: 2, onStage });
  return {
    ok: true, kind: 'record',
    markdown: r.content.trim(),
    mock: !!r.mock, model: r.model || null, continued: !!r.continued,
    at: Date.now(), mode: secs
  };
}

async function runAsk(payload, onStage) {
  const stage = typeof onStage === 'function' ? onStage : null;
  if (stage) { try { stage({ stage: 'prep', round: 0 }); } catch (e) { /* 忽略 */ } }
  const question = String(payload.question || '').trim();
  if (!question) return { ok: false, error: '问题为空' };
  const hits = rag.search(question, 8);
  const ctxText = rag.toContext(hits);
  const sys = ROLE;
  // 辨证分析类长答案常超单次 max_tokens → 走续写（与 runRecord 同参数），截断不再丢尾巴。
  const r = await chatContinue(sys, buildAskPrompt(question, ctxText), { maxTokens: 2600, timeout: 150000, continueMax: 2, onStage: stage });
  return {
    ok: true, kind: 'ask',
    answer: r.content.trim(),
    refs: hits.map(h => ({ kind: h.kind === 'formula' ? '方剂' : '中药', name: h.name })),
    mock: !!r.mock, model: r.model || null, at: Date.now()
  };
}

async function runTest() {
  if (IS_MOCK) return { ok: true, content: '正常（演示模式）', mock: true, model: 'mock' };
  const e = chatEntry();
  if (!e) return { ok: false, error: '未配置对话模型', hasKey: false };
  try {
    const r = await callChat([{ role: 'system', content: '你是连通性测试助手。' }, { role: 'user', content: '请只回复两个字：正常' }], { entry: e, maxTokens: 8, temperature: 0 });
    return { ok: true, content: r.content, mock: !!r.mock, model: r.model || null };
  } catch (err) { return { ok: false, error: err.message, hasKey: !!e.apiKey }; }
}
/** 测试指定模型条目连通性（后台模型列表每行的「测试」按钮） */
/** 视觉模型连通性探测图：64×64 纯色 PNG（glm-4v 等视觉模型不接受纯文本消息，纯文本探测会返回空 content） */
function visionProbePng() {
  const zlib = require('zlib');
  function crc32(buf) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } let cr = 0xFFFFFFFF; for (const b of buf) cr = t[(cr ^ b) & 0xFF] ^ (cr >>> 8); return (cr ^ 0xFFFFFFFF) >>> 0; }
  function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
  const W = 64, H = 64, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) { raw[y * (1 + W * 3)] = 0; for (let x = 0; x < W; x++) { const o = y * (1 + W * 3) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 60; raw[o + 2] = 50; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function runTestModel(id) {
  const e = cfg.models.find(m => m.id === id);
  if (!e) return { ok: false, error: '找不到该模型条目' };
  if (IS_MOCK) return { ok: true, content: '正常（演示模式）', mock: true, model: 'mock' };
  if (!e.apiKey || !endpoint(e)) return { ok: false, error: '该条目未填写 API Key 或接口地址' };
  try {
    // 视觉/双用途条目：发图片探测（纯文本会被视觉模型返回空 content，误报"返回内容为空"）
    const r = (e.role === 'vision' || e.role === 'both')
      ? await callChat([{ role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + visionProbePng().toString('base64') } },
          { type: 'text', text: '这是一张测试图。请只回复两个字：正常' }
        ] }], { entry: e, maxTokens: 16, temperature: 0 })
      : await callChat([{ role: 'user', content: '请只回复两个字：正常' }], { entry: e, maxTokens: 8, temperature: 0 });
    return { ok: true, content: r.content, model: r.model || e.model };
  } catch (err) { return { ok: false, error: err.message }; }
}

// ---------- 供渲染层展示的模型状态 ----------
function modelLabel() {
  const e = chatEntry();
  if (!e) return '未配置';
  return (e.label ? e.label + ' · ' : '') + (e.model || '未填模型名');
}

const api = {
  initAi, publicCfg, updateCfg, runAi, runTest, runTestModel, chat, ready, modelLabel, providers: AI_PROVIDERS,
  visionOcr, visionReady, visionModelLabel,
  _status: () => ({ ...publicCfg(), modelLabel: modelLabel() })
};

module.exports = api;
