// lib/analyze.js - 对抓取文本做结构化分块（病历 / 医嘱 识别）与脱敏
const { cleanText, normalizeOcrText } = require('./capture');
const { isNoiseLine } = require('./noise');
const gbt = require('./gbt');
const icdmap = require('./icdmap');

// 常见脱敏模式
const MASK_RULES = [
  { name: '身份证', re: /\b\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, mask: m => m.slice(0, 6) + '********' + m.slice(14) },
  { name: '手机号', re: /\b1[3-9]\d{9}\b/g, mask: m => m.slice(0, 3) + '****' + m.slice(7) },
  { name: '住院号', re: /(住院号|病案号|病历号|床号|门诊号|ID号|住院NO)[:：]?\s*([A-Za-z0-9\-]{4,})/gi, mask: m => m.replace(/(\d[A-Za-z0-9]{3})([A-Za-z0-9\-]+)$/, (_, a, b) => a + '*'.repeat(Math.min(b.length, 4)) + (b.length > 4 ? b.slice(4) : '')) },
  { name: '患者名', re: /(患者|姓名)[:：]\s*([\u4e00-\u9fa5·]{2,6})/g, mask: m => m.replace(/([\u4e00-\u9fa5·])([\u4e00-\u9fa5·]+)$/, (_, a, rest) => a + '*'.repeat(rest.length)) },
];

function maskText(text, opts) {
  // 先做 OCR 归一化（逐字空格/全角字符），再脱敏，保证展示与引擎共用干净文本
  // opts.keepSpaces=true：剪贴板等原生文本，保留汉字间空格（不按 OCR 规则压缩）
  let out = normalizeOcrText(text, opts);
  for (const r of MASK_RULES) {
    try { out = out.replace(r.re, r.mask); } catch (e) { /* ignore single rule failure */ }
  }
  return out;
}

// 医嘱关键词（行匹配）
const ORDER_MARKERS = [
  '医嘱', '长期医嘱', '临时医嘱', '静脉输液', '口服', '用法', '每日', 'tid', 'bid', 'qd', 'qn', 'qm',
  '片', '粒', '支', '瓶', '袋', '丸', 'g', 'mg', 'ml', '中药', '汤剂', '颗粒', '西药', '中成药'
];
// 病历文书关键词
const RECORD_MARKERS = [
  '主诉', '现病史', '既往史', '个人史', '家族史', '过敏史', '望闻问切', '望诊', '闻诊', '问诊', '切诊',
  '舌', '苔', '脉', '辨证', '证型', '治法', '方药', '中医诊断', '西医诊断', '体格检查', '辅助检查',
  '入院记录', '病程记录', '首程', '查体', '神志', '面色', '精神'
];

/**
 * HIS 用法尾巴折行回拼（2026-10-17）：HIS 处方按宽度折行，OCR 照行抓会把
 * 「每日1剂院内煎常规煎分早晚两次饭后内服」断成「党参10g每」+「日1剂…」+「早晚…」。
 * ① 药味行尾悬挂的「每」与下一行「日N剂…」拼回；② 用法续行并入成一行；
 * ③ 每味药重复印的同一用法行只保留一条（去重后分块不再 其它/医嘱内容 交替刷屏）。
 * 仅用于机器识别来源（clipboard 医生手输不经过此函数）。
 */
function reflowWrappedUsage(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  const seenUsage = new Set();
  // 用法续行：以服法/频次词开头，且不是新药味行（不含克数剂量）
  const isUsageCont = (l) =>
    /^(?:早晚|中午|晚间|分早|分服|饭后|饭前|睡前|顿服|温服|水煎服|煎服|内服|外用|每日|隔日)/.test(l)
    && !/\d{1,4}(?:\.\d{1,2})?\s*(?:g|G|克|ml|mg)/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 变体一：药味行尾悬挂「每」，下一行以「日N剂」开头 → 拼回
    if (/[gG克]每$/.test(line) && i + 1 < lines.length && /^日\d+剂/.test(lines[i + 1])) {
      const herb = line.replace(/每$/, '');
      let usage = '每' + lines[i + 1];
      i += 2;
      while (i < lines.length && isUsageCont(lines[i])) {
        // HIS 每味药重复印同一用法：续行已被 usage 包含 → 只跳过不再拼（否则拼出「A。A。A」）
        if (usage.includes(lines[i])) { i++; continue; }
        usage += lines[i]; i++;
      }
      i--;
      usage = usage.replace(/[)）]+\s*$/, '');
      out.push(herb);
      if (usage && !seenUsage.has(usage)) { seenUsage.add(usage); out.push(usage); }
      continue;
    }
    // 变体二：「每日N剂…」独立成行（「每」未悬挂）→ 连并续行后去重
    if (/^每日\d+剂/.test(line)) {
      let usage = line;
      while (i + 1 < lines.length && isUsageCont(lines[i + 1])) {
        const nx = lines[i + 1];
        // 同变体一：重复印的同一用法行只跳过，绝不往回拼
        if (usage.includes(nx)) { i++; continue; }
        i++; usage += nx;
      }
      usage = usage.replace(/[)）]+\s*$/, '');
      if (usage && !seenUsage.has(usage)) { seenUsage.add(usage); out.push(usage); }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * 把整段文本切成若干"块"，每块标记 probable 类型。
 * 逐行判定：医嘱行→order 块；病历要素行→record 块；其余行汇入 other 块（连续同类合并）。
 */
function splitIntoSections(text, opts) {
  const raw = cleanText(text, opts);
  // 第二道噪声防线：界面标签/碎片行不入块（保护旧记录重渲染场景）
  const lines = raw.split('\n').map(s => s.trim()).filter(Boolean).filter(l => !isNoiseLine(l));
  const sections = [];
  let cur = null;

  const ensure = (type) => {
    if (!cur || cur.type !== type) {
      cur = { type, content: [] };
      sections.push(cur);
    }
  };

  for (const line of lines) {
    const c = classifyLine(line);
    const type = c.score > 0 ? c.type : 'other';
    // 强命中时，若正在累积 other 块则切换
    if (c.strong && cur && cur.type === 'other' && type !== 'other') ensure(type);
    ensure(type);
    cur.content.push(line);
    // 若当前为命中块（order/record），连续普通行最多并入 11 行作上下文，
    // 超过后回落到 other，防止整页文本被误并入。
    if (cur.type !== 'other' && type === 'other' && cur.content.length >= 12) {
      cur.content.pop();
      ensure('other');
      cur.content.push(line);
    }
  }
  if (!sections.length) return [];
  // other 收尾：若 other 块很短且前后都是同型块，折叠相邻
  return sections.map(s => ({ type: s.type, content: s.content.join('\n') }))
    .filter(s => s.content.trim());
}

function classifyLine(line) {
  let order = 0, record = 0;
  // 医嘱行特征：以频次/用法/给药途径开头 或 剂量+单位 或 明确医嘱词
  if (/^(?:tid|bid|qd|qn|qm|qod|po|ivgtt|iv|im|sc|st)\b/i.test(line.trim())) order += 3;
  if (/(每日|隔日|每晚|口服|静滴|静脉|肌注|皮下|外用|饭前|饭后|睡前|晨起)/.test(line)) order += 2;
  if (/\d+(?:\.\d+)?\s*(?:g|mg|ml|片|粒|支|袋|丸|剂|包|单位|u|iu)\b/i.test(line) || /(?:片|粒|支|袋|丸|剂|包)[，,、]?\s*(?:tid|bid|qd|qn|每日|每晚)/i.test(line)) order += 2;
  if (/^(?:长期医嘱|临时医嘱|医嘱|处方|中药|西药|中成药|用法)/.test(line.trim())) order += 2;
  // 中药饮片行守卫："黄芪 30g / 黄连 12g" 这类「纯中文药名+克数」行是处方内容而非西药医嘱——
  // 无频次/途径/西药剂型关键词且单位仅为 g/克 时，撤回 order 计分，使其并入其它/处方块
  // （否则会单独拆成「医嘱内容」段，与相邻处方块割裂）。西药行通常含 mg/ml/片/粒/频次等特征，不受影响。
  if (order > 0
      && (/^[\u3400-\u4dbf\u4e00-\u9fa5]{1,12}(?:\s+\d{1,4}(?:\.\d{1,2})?\s*(?:g|G|克))?$/.test(line.trim())
          || /^\d{1,4}(?:\.\d{1,2})?\s*(?:g|G|克)$/.test(line.trim())) // 独立克数行（竖排处方滞后剂量）同属处方内容
      && !/(?:每日|隔日|每晚|口服|静滴|静脉|肌注|皮下|外用|饭前|饭后|睡前|晨起|tid|bid|qd|qn|qm|qod|片|粒|支|袋|丸|剂|包|mg|ml|iu)/i.test(line)) {
    order = 0;
  }
  // 病历要素特征
  for (const k of RECORD_MARKERS) { if (line.includes(k)) record += 1; }
  const looksRecord = /^(?:主诉|现病史|既往史|个人史|家族史|过敏史|体格检查|望|闻|问|切|舌|脉|辨证|治法|方药|中医诊断|西医诊断|临床诊断|入院|病程)/.test(line.trim());
  if (looksRecord) record += 2;
  // 中药饮片行守卫·强化：含 g/克 剂量、去掉剂量后只剩中文药名（可多味/带炮制括号）的行是处方内容，
  // order 与 record 计分一并撤回——防止药名含单字病历关键词（如白花蛇舌草含「舌」）被误判为病历文书块，
  // 既脱离处方编辑器又挂错分类标签。必须放在 record 计分之后：先撤分再汇总。
  // 真正的病历行（舌红苔黄腻/脉滑）不含剂量 token，不受影响；西药行残留字母/数字（mmHg/5%）非纯中文，也不受影响。
  if (/\d{1,4}(?:\.\d{1,2})?\s*(?:g|G|克)/.test(line)
      && !/(?:每日|隔日|每晚|口服|静滴|静脉|肌注|皮下|外用|饭前|饭后|睡前|晨起|tid|bid|qd|qn|qm|qod|片|粒|支|袋|丸|剂|包|mg|ml|iu)/i.test(line)) {
    const residue = line.trim()
      .replace(/\d{1,4}(?:\.\d{1,2})?\s*(?:g|G|克)/g, '')
      .replace(/[（(][^（）()]*[）)]/g, '')  // 炮制/备注括号：炒白芍（打碎）
      .trim();
    if (residue && /^[\u3400-\u4dbf\u4e00-\u9fa5·、，,\s]+$/.test(residue)) { order = 0; record = 0; }
  }
  // 决定：取分高者；医嘱 dose 命中权重高一些
  order = Math.min(order, 6); record = Math.min(record, 6);
  if (order === 0 && record === 0) return { type: 'other', score: 0, strong: false };
  if (order >= record) return { type: 'order', score: order, strong: order >= 3 };
  return { type: 'record', score: record, strong: record >= 3 };
}

// ---- 诊断/证型值清洗：去括号及内容、去标签残留与首尾符号，仅保留诊断与证型本体 ----
// 诊断内噪声：HIS 防复制会在字间混入点号/间隔号（乳.腺肿瘤、乳.岩），字间空格同属噪声 → 相邻汉字间直接粘连
const DIAG_NOISE_DOT = /([\u4e00-\u9fa5])[.。．｡•·﹒]+(?=[\u4e00-\u9fa5])/g;
const DIAG_NOISE_GAP = /([\u4e00-\u9fa5])[ \t\u3000]+(?=[\u4e00-\u9fa5])/g;
function cleanDiagVal(s) {
  return String(s || '')
    .replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '')   // 括号及内容整体去除（（双）（左）等）
    .replace(/(初步|入院|门诊|出院|中医|西医)?诊断[:：]?/g, '') // 标签残留
    .replace(DIAG_NOISE_DOT, '$1').replace(DIAG_NOISE_GAP, '$1') // 字间噪声点/空格粘连（诊断名内不含合法点号）
    .replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+|[^\u4e00-\u9fa5A-Za-z0-9]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
// 西医诊断值 → 条目数组：按编号/换行/分隔符切开，括号内容已除，保留含文字的条目；
// 含「数字+剂量单位」的条目（伸筋草 15g、阿司匹林 100mg）是药品/医嘱行不是诊断 → 剔除
const WEST_DOSE = /\d(?:\.\d+)?\s*(?:mg|ml|μg|ug|iu|g|片|粒|支|袋|丸|贴)/i;
function westItems(v) {
  return String(v || '')
    .replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '')
    .split(/[\n；;，,、]+|\d+[.、，)）:：]\s*/)
    .map(s => s.replace(/^[^\u4e00-\u9fa5A-Za-z0-9-]+|[^\u4e00-\u9fa5A-Za-z0-9-]+$/g, '').trim())
    .filter(s => /[\u4e00-\u9fa5A-Za-z]{2,}/.test(s) && !WEST_DOSE.test(s));
}
// "创伤病 气滞血瘀证" 同行连写：末词以"证"结尾时拆为 诊断+证型
function splitTcmDiagSynd(v) {
  const parts = String(v || '').split(/\s+/).filter(Boolean);
  if (parts.length > 1 && /证$/.test(parts[parts.length - 1])) {
    return { diag: parts.slice(0, -1).join(''), synd: parts[parts.length - 1] };
  }
  return { diag: v, synd: null };
}

/** 汇总提取四诊/辨证等关键行，供岐黄鉴方后续引擎使用 */
function extractKeyPoints(text) {
  const keys = {};
  const rules = [
    ['主诉', /主诉[:：]?\s*([^\n]{2,80})/],
    ['现病史', /现病史[:：]?\s*([^\n]{2,200})/],
    // 舌/脉必须位于行首或标点后（防"白花蛇舌草 12g"中段"舌"被误提为 舌象:"草 12g"）；
    // (?!下含|下服) 防「硝酸甘油 舌下含服（胸痛发作时）」被截成 舌象:"下含服（胸痛发作时）"
    ['舌象', /(?<![一-龥])舌(?:象|质|苔|体)?(?!下含|下服)[:：]?\s*([^\n，。；\t]{1,40})/],
    ['脉象', /(?<![一-龥])脉(?:象)?[:：]?\s*([^\n，。；]{1,40})/],
    // 中医诊断/西医诊断独立要素：值在下一个标签前截止；证型不再与中医诊断混用
    // 冒号可选（OCR 常把"中医诊断：创伤病"识别成"中医诊断创伤病"）
    // 「(中医|临床)诊断及证型：A,B,痰瘀阳络证」混排一行：值内含逗号，前瞻只到强标签/行尾；
    // 后处理按"证"结尾拆为 中医诊断+证型。中医诊断/证型两条规则加负向断言，防止在混合标签上误截。
    ['临床诊断及证型', /(?:中医|临床)?诊断(?:及|与|和)证型[:：]?\s*([^\n]{2,80}?)(?=\s*(?:西医诊断|中医诊断|治法|主诉)|$)/],
    ['中医诊断', /中医诊断(?![及与和])[:：]?\s*([^\n]{2,60}?)(?=\s*(?:西医诊断|辨证|证型|证候|治法|主诉|[；;，。])|$)/],
    ['证型', /(?<![及与和])(?:辨证|证型|证候)[:：]?\s*([^\n]{2,60}?)(?=\s*(?:西医诊断|中医诊断|治法|主诉|[；;，。])|$)/],
    ['治法', /治法[:：]?\s*([^\n]{2,60})/],
  ];
  const fullText = String(text || '');
  const lines = fullText.split('\n');
  for (const [key, re] of rules) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (m && m[1]) {
        keys[key] = m[1].trim();
        // 混排行 HIS 折行：「临床诊断及证型 ： 乳腺肿瘤,多汗症,」\n「痨瘀阳络证,湿热」——
        // 证型落在续行会整行丢失。续行判定：无冒号、非病历标签开头、纯「中文+分隔符」的短行。
        if (key === '临床诊断及证型') {
          for (let j = i + 1; j < lines.length; j++) {
            const nx = lines[j].trim();
            if (!nx) continue;
            if (/[:：]/.test(nx)) break;
            if (/^(?:西医诊断|中医诊断|治法|主诉|现病史|既往史|体格检查|辅助检查|R\b)/.test(nx)) break;
            if (!/^[\u4e00-\u9fa5][\u4e00-\u9fa5，,、;；\s]{0,40}$/.test(nx)) break;
            keys[key] = keys[key].replace(/[，,、;；\s]+$/, '') + ',' + nx;
          }
        }
        // 证型换行连写："中医诊断：创伤病\n气滞血瘀证\n西医诊断…" → 诊断行之后、
        // 下一个病历标签之前的纯汉字独立行（以"证"结尾）归为证型
        if (key === '中医诊断' && !keys['证型']) {
          for (let j = i + 1; j < lines.length; j++) {
            const nx = lines[j].trim();
            if (!nx) continue;
            if (/^(?:西医诊断|辨证|证型|证候|治法|主诉|现病史|既往史|体格检查|辅助检查)/.test(nx) || /^[①②③④1-9]/.test(nx)) break;
            if (/^[\u4e00-\u9fa5]{2,12}证$/.test(nx)) { keys['证型'] = nx; break; }
            break; // 非证型文本行即停
          }
        }
        break;
      }
    }
  }
  // HIS 卡片布局 OCR：标签与值分行（「中医诊断\n胸痹\n证型\n气虚血瘀证\n主诉\n反复胸闷痛 2 年…」）。
  // 行内规则取不到值（标签独占一行），逐行扫描补值：纯标签行 → 下一非空「纯值行」。
  // 不覆盖 rules 已提取的键；编号续行（1.肘挫伤…）不补，交西医诊断整段规则处理。
  const LABEL_WORDS = ['中医诊断', '西医诊断', '临床诊断及证型', '证型', '证候', '辨证', '治法', '主诉', '现病史'];
  const VALUE_BAD_HEAD = /^(?:西医诊断|中医诊断|临床诊断及证型|证型|证候|辨证|治法|主诉|现病史|既往史|个人史|家族史|过敏史|体格检查|查体|辅助检查|护理|过敏|入院|出院|床号|住院号|科室|姓名|性别|年龄|医保|长期医嘱|临时医嘱|Rp)/;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const lab = LABEL_WORDS.find(w => t === w || t === w + ':' || t === w + '：');
    if (!lab || keys[lab]) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const nx = lines[j].trim();
      if (!nx) continue;
      // HIS 折行常见「标签独占一行、冒号+值在下一行」（临床诊断及证型\n：乳腺肿瘤，…）：
      // 值行以冒号开头时剥掉行首冒号，其余仍是「纯中文+分隔符」才取值；剥后含其他标签/表格特征则放弃
      let val = nx;
      if (/^[:：]/.test(val)) val = val.replace(/^[:：\s]+/, '');
      if (!val) break;
      if (/[:：]/.test(val) || val.includes('\t')) break;   // 冒号行=其他标签；表格行不取
      if (VALUE_BAD_HEAD.test(val) || /^\d+[.、]/.test(val)) break;
      if (val.length < 2 || val.length > 80) break;
      keys[lab] = val;
      break;
    }
  }
  // 西医诊断常按编号跨多行（1.肘挫伤…\n2.髋部损伤…），须整段匹配；下一个病历标签处截止
  if (!keys['西医诊断']) {
    const m = fullText.match(/西医诊断[:：]?\s*([\s\S]{2,200}?)(?=\n\s*(?:中医诊断|主诉|现病史|既往史|体格检查|辅助检查|初步诊断|辨证|证型|治法|Rp|RP|用法|注意|成份|成分|医师|药师|审核|调配|金额|剂数)|$)/);
    if (m && m[1]) keys['西医诊断'] = m[1].trim();
  }
  // 舌象双保险：值混入「含服/含化」（舌下含服被折行切开）、医嘱频次/给药途径词（prn/qd…），
  // 或仅剩孤字「下」（「舌下」给药列）→ 整体丢弃，宁缺勿错
  const TV = (keys['舌象'] || '').trim();
  if (keys['舌象'] && (!/[\u4e00-\u9fa5]/.test(TV) || /含服|含化/.test(TV)
    || /(?:prn|qd|qn|bid|tid|qod|st)\b/i.test(TV) || TV === '下')) delete keys['舌象'];
  // 诊断类值清洗：去括号内容/标签/编号/符号，仅留本体；西医诊断拆条目后顿号连接
  if (keys['中医诊断']) {
    const { diag, synd } = splitTcmDiagSynd(keys['中医诊断']);
    keys['中医诊断'] = cleanDiagVal(diag);
    if (synd && !keys['证型']) keys['证型'] = cleanDiagVal(synd);
    if (!keys['中医诊断']) delete keys['中医诊断'];
  }
  // 「临床诊断及证型：乳腺肿瘤,多汗症,乳岩,汗病,痰瘀阻络证,湿热」混排一行：三级分类拆为 西医/中医/证型（见下）
  const SYND_ELEMENTS = ['湿热', '寒湿', '风湿', '风热', '风寒', '暑湿', '燥热', '痰热', '痰湿', '痰浊', '痰瘀',
    '血瘀', '瘀血', '血虚', '血热', '气虚', '气滞', '气陷', '阴虚', '阳虚', '阳亢', '津亏',
    '肝郁', '肝火', '胃寒', '胃热', '热毒', '湿阻', '里热', '表寒', '表热', '虚寒', '虚热', '毒盛'];
  const isSyndWord = p => /证$/.test(p) || (p.length === 2 && SYND_ELEMENTS.includes(p));
  if (keys['临床诊断及证型']) {
    // 分隔以逗号/顿号/分号为准；字间噪声点与空格（HIS 防复制的「乳.腺肿瘤」「多 汗 症」）先粘连回词再拆条
    const parts = keys['临床诊断及证型']
      .replace(DIAG_NOISE_DOT, '$1').replace(DIAG_NOISE_GAP, '$1')
      .split(/[，,、;；]+/).map(s => s.trim()).filter(Boolean);
    // 三级分类（2026-10-23）：①证型规则（"证"尾/两字证素）→ ②GB/T 中医病名库（正名/别名精确命中→归一并收敛正名）
    // → ③ICD 国临版西医名精确命中 → 归西医诊断；都未命中 → 兜底归中医诊断（宁缺勿错，不做模糊改写）。
    // 库未就绪/异常时全部兜底中医诊断，行为与旧版一致。
    let gbtHit = null;
    try { gbtHit = gbt.matchNames(parts); } catch (e) { gbtHit = null; }
    const synds = [], tcm = [], west = [], other = [];
    for (const p of parts) {
      const v = cleanDiagVal(p);
      if (!v) continue;
      if (isSyndWord(p)) { synds.push(v); continue; }
      const g = gbtHit && gbtHit.get(p);
      if (g) { tcm.push(v); continue; }   // 命中 GB/T 即归中医诊断，保留 HIS 原词（乳岩不改乳癌）
      let w = null;
      try {
        const hit = icdmap.lookupByName(v);
        if (hit && (hit.glName === v || hit.ybName === v)) w = hit.glName;
      } catch (e) { /* 库未就绪 */ }
      if (w) { west.push(w); continue; }
      other.push(v);
    }
    if (synds.length) keys['证型'] = synds.join('、');
    const tcmAll = tcm.concat(other);
    if (tcmAll.length && !keys['中医诊断']) keys['中医诊断'] = tcmAll.join('、');
    if (west.length && !keys['西医诊断']) keys['西医诊断'] = west.join('、');
    delete keys['临床诊断及证型'];
    if (!keys['中医诊断']) delete keys['中医诊断'];
  }
  if (keys['西医诊断']) {
    const items = westItems(keys['西医诊断']);
    if (items.length) keys['西医诊断'] = items.map(cleanDiagVal).join('、');
    else delete keys['西医诊断'];
  }
  if (keys['证型']) {
    keys['证型'] = cleanDiagVal(keys['证型']);
    if (!keys['证型']) delete keys['证型'];
  }
  return keys;
}

/** 处方「用法」抓取（水煎服 / 每日1剂 / 分2次温服 / 外用 / 冲服 …）。
 *  返回 { usage, src }：src = label（带"用法/服法/Sig"标签）| inline（正文里带煎服关键词）| ''（没抓到）。
 *  口径：抓到的是"怎么用"，不是药味本身——因此无标签时只取煎服/频次片段（从关键词起、到句读止），
 *  绝不整行照搬（医嘱行常是「黄芪 30g 水煎服」，整行搬会把药名剂量带进来）。 */
const RE_USAGE_LABEL = /^(?:用法用量|用法与用量|用法|服法|煎服法|煎煮法|煎法|用药方法|服用方法|Sig|sig|SIG)[:：]?(.*)$/;
const RE_USAGE_INLINE = /(水煎(?:服|取汁)?[^，。；、\n]*|每日\s*[0-9一二三四五六七八九十两半]\s*剂[^，。；、\n]*|每剂[^，。；、\n]*|[日每]\s*1\s*剂[^，。；、\n]*|冲服[^，。；、\n]*|烊化[^，。；、\n]*|温服[^，。；、\n]*|分\s*[0-9一二两]\s*次[^，。；、\n]*|外敷[^，。；、\n]*|外用[^，。；、\n]*|熏洗[^，。；、\n]*|含服[^，。；、\n]*|雾化[^，。；、\n]*|贴敷[^，。；、\n]*|泡服[^，。；、\n]*)/;
const RE_USAGE_FREQ = /\b(?:bid|tid|qd|qid|q8h|q12h)\b/i;
function pickUsage(text) {
  const lines = String(text || '').split('\n');
  // ① 带标签：取冒号后内容；标签后为空则顺延下一非空行（HIS 常把值放到下一行）
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(RE_USAGE_LABEL);
    if (!m) continue;
    let v = String(m[1] || '').trim();
    if (!v) {
      for (let j = i + 1; j < lines.length; j++) {
        const nx = lines[j].trim();
        if (!nx) continue;
        if (/^(?:中医诊断|西医诊断|主诉|现病史|既往史|体格检查|辅助检查|治法|辨证|证型|处方|医嘱)/.test(nx)) break;
        v = nx; break;
      }
    }
    v = cleanUsageVal(v);
    if (v) return { usage: v, src: 'label' };
  }
  // ② 无标签：收集全部含煎服/给药/频次关键词的片段（只取关键词起始的一段，不吃药名剂量）。
  //    医嘱常把用法拆成多行（「每日1剂」「外用」各一行）——只取第一个会丢给药途径（外用豁免就失效了），
  //    因此合并：给药途径在前、其余居中、频次殿后，重复/互含片段去重。
  const frags = [];
  const pushFrag = (v) => { v = cleanUsageVal(v); if (v && !frags.includes(v)) frags.push(v); };
  for (const ln of lines) {
    const s = String(ln || '').trim();
    if (!s) continue;
    // 纯药味行（黄芪 30g / 当归 12g）不算用法
    const m = s.match(RE_USAGE_INLINE);
    if (m) {
      // 片段后紧跟的频次尾巴并进来（「外用，每日2次」→ 只取「外用」会丢频次）
      let seg = m[1];
      const tail = s.slice(s.indexOf(m[1]) + m[1].length)
        .match(/^[,，、]\s*(?:每日[^。；\n]*|日\s*[0-9一二两]\s*次[^。；\n]*|分\s*[0-9一二两]\s*次[^。；\n]*)/);
      if (tail) seg = m[1] + '，' + tail[0].replace(/^[,，、]\s*/, '');
      pushFrag(seg);
      continue;
    }
    if (RE_USAGE_FREQ.test(s)) {
      pushFrag(s.replace(/^\s*[^\s]*?\d{1,4}(?:\.\d{1,2})?\s*(?:g|G|克)\s*/, ''));
    }
  }
  if (!frags.length) return { usage: '', src: '' };
  if (frags.length === 1) return { usage: frags[0], src: 'inline' };
  const isRoute = (v) => /^(?:外用|外敷|外涂|外擦|涂擦|涂抹|搽|敷贴|贴敷|熏洗|外洗|坐浴|泡洗|含漱|漱口|冲洗|灌注|灌肠|滴鼻|点眼|滴耳|雾化|水煎|冲服|烊化|含服|泡服)/.test(v);
  const isFreq = (v) => /(?:每日|日)\s*[0-9一二三四五六七八九十两半]*\s*(?:剂|次)|分\s*[0-9一二两]\s*次|\b(?:bid|tid|qd|qid)\b/i.test(v);
  const ordered = [
    ...frags.filter(v => isRoute(v) && !isFreq(v)),
    ...frags.filter(v => !isRoute(v) && !isFreq(v)),
    ...frags.filter(v => isFreq(v)),
  ];
  // 装配时互含双向去重：「每日1剂院内煎常规煎」与「每日1剂院内煎常规煎分早晚…」
  // 谁先谁后都只保留长的那条——HIS 每味药重复印用法且折行截断位置不一，单向去重会拼出重复串
  const picked = [];
  for (const v of ordered) {
    if (picked.some(p => p.includes(v) || v.includes(p))) continue;
    picked.push(v);
  }
  const out = picked.join('，');
  return { usage: cleanUsageVal(out) || frags[0], src: 'inline' };
}
// 用法括号修复（2026-10-19）：OCR 常丢右括号（「含服(胸痛发作时，每日1剂」）或全半角混用。
// 统一为全角；左括号多出时补在（之后第一个「，」前——丢括号时内容边界就是分隔逗号；无逗号补尾。
// 右括号多出（丢了左括号）则去掉多余的最后一个「）」。
function fixUsageParens(s) {
  s = String(s || '').replace(/\(/g, '（').replace(/\)/g, '）');
  for (let k = 0; k < 3; k++) {
    const opens = (s.match(/（/g) || []).length;
    const closes = (s.match(/）/g) || []).length;
    if (opens > closes) {
      const i = s.lastIndexOf('（');
      const j = s.indexOf('，', i);
      s = j >= 0 ? s.slice(0, j) + '）' + s.slice(j) : s + '）';
    } else if (closes > opens) {
      const i = s.lastIndexOf('）');
      s = s.slice(0, i) + s.slice(i + 1);
    } else break;
  }
  return s;
}
function cleanUsageVal(v) {
  let s = String(v || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[:：、,，.\s]+/, '').replace(/[;；\s]+$/, '');
  s = fixUsageParens(s);
  // 句级去重（reflow 之后第二道防线）：HIS 每味药重复印用法，OCR/视觉模型把整列并成一行时
  // 得到「每日1剂…内服。每日1剂…内服。…」——按句切开互含去重（保留长者），只留一份
  const sents = s.split(/[。；;！？!?]+/).map(x => x.trim()).filter(Boolean);
  if (sents.length > 1) {
    const keep = [];
    for (const p of sents) {
      if (keep.some(q => q.includes(p) || p.includes(q))) continue;
      keep.push(p);
    }
    s = keep.join('，');
  }
  if (s.length > 60) s = s.slice(0, 60);
  // 太短或不像用法（纯数字/纯剂量）不收
  if (s.length < 2) return '';
  if (/^\d{1,4}(?:\.\d{1,2})?\s*(?:g|G|克)$/.test(s)) return '';
  return s;
}

/** 外用类给药判定：药典「用法与用量」的常用量为内服量，外用给药一般标注「适量」，
 *  不适用内服上限核查（栀子 30g 内服超量、外用正常）。覆盖常见外用/局部给药写法。 */
const RE_EXTERNAL_USAGE = /外用|外敷|外涂|外擦|涂擦|涂抹|搽剂|搽患|敷贴|贴敷|患处|熏洗|外洗|坐浴|泡洗|含漱|漱口|冲洗|灌注|灌肠|滴鼻|点眼|滴耳|吹敷|喷洒|雾化吸入|保留灌肠/;
function isExternalUsage(u) { return RE_EXTERNAL_USAGE.test(String(u || '')); }

/** 竖排处方合并：划价界面"药名一行、克数一行"（太子参⏎15g⏎姜厚朴⏎12g…），OCR 逐行输出后
 *  分段被拆成 其它/医嘱内容 交替、方剂剂量解析（tcm.js doseInLine 行内匹配）全部落空。
 *  此处把独立克数行并回上一行药名 → "太子参 15g"。
 *  保守防误伤：①克数行须形如 15g / 4.5克（纯数字+g/克）②上一行须为 1-8 字纯汉字药名（无标点/数字/冒号）
 *  ③上一行本身未带剂量（"炙甘草 6g" 后再出现 "9g" 不继续并）④下一行无约束（只回看一行）。 */
const RE_DOSE_LINE = /^\d{1,4}(?:\.\d{1,2})?\s*(?:g|G|克)$/;
const RE_HERB_NAME = /^[\u3400-\u4dbf\u4e00-\u9fa5]{1,8}$/;
function mergeDoseLines(text) {
  const out = [];
  for (const ln of String(text || '').split('\n')) {
    const s = ln.trim();
    if (RE_DOSE_LINE.test(s)) {
      // 就近回看（≤4 行）找最近一个未带剂量的纯药名行并回。
      // 两列竖排被 OCR 打乱行序时（药名几行连排、克数滞后成串），单纯并到上一行不够：
      // "炒六神曲⏎甘草⏎生麦芽 10g⏎12g⏎12g" → 两个 12g 逆序回填给 甘草/炒六神曲
      let merged = false;
      for (let i = out.length - 1, step = 0; i >= 0 && step < 4; i--, step++) {
        const cand = out[i].trim();
        if (!cand) continue;
        if (/\d\s*(?:g|G|克)$/.test(cand)) continue; // 已带剂量的药名行（生麦芽 10g）跳过，继续回看
        if (!RE_HERB_NAME.test(cand)) break;         // 碰到非药名行（正文/标点）停止回看
        out[i] = cand + ' ' + s;
        merged = true;
        break;
      }
      if (!merged) out.push(ln); // 回看不中则保留原行（交由后续管线处理）
      continue;
    }
    out.push(ln);
  }
  return out.join('\n');
}

// ---------- 科室提取（归档检索用，2026-10-19） ----------
// HIS/EMR 里的科室标签写法很杂：科别：脾胃病科 / 科室:骨伤科 / 就诊科室：针灸推拿科门诊 /
// 申请科室 肺病科（OCR 丢冒号）。只认带标签的，值须为 2~20 个非空白非标点字符；
// 不做「病区/床号」这类更靠后的字段推断，避免把「执行科室」当临床科室。
// 与 Domain/Analyze.cs PickDept 逐字同源（对拍 chan_capture_dept）。
const RE_DEPT_LABEL = '科别|就诊科室|申请科室|开单科室|住院科室|入院科室|门诊科室|科室';
const RE_DEPT_COLON = new RegExp('(?:' + RE_DEPT_LABEL + ')[ \\t\\u3000]*[:：][ \\t\\u3000]*([^\\s\\uFF0C\\uFF1B\\u3002\\uFF1A\\uFF08\\uFF09,;:()]{2,20})');
const RE_DEPT_SPACE = new RegExp('(?:' + RE_DEPT_LABEL + ')[ \\t\\u3000]+([^\\s\\uFF0C\\uFF1B\\u3002\\uFF1A\\uFF08\\uFF09,;:()]{2,20})');
const DEPT_BAD = /^(?:科室|科别|医生|医师|护士|姓名|门诊|住院|病区|床号)$/;
function pickDept(text) {
  const t = String(text || '');
  const m = t.match(RE_DEPT_COLON) || t.match(RE_DEPT_SPACE);
  if (!m) return '';
  const v = String(m[1] || '').trim().replace(/^[·\-—_]+|[·\-—_]+$/g, '');
  if (v.length < 2 || DEPT_BAD.test(v)) return '';
  return v.slice(0, 20);
}

module.exports = { maskText, splitIntoSections, extractKeyPoints, classifyLine, mergeDoseLines, pickUsage, isExternalUsage, reflowWrappedUsage, pickDept };
