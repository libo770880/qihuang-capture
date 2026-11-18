// lib/compliance.js - 岐黄鉴方「合规提示建议」本地规则引擎（MVP）
// 对抓取到的病历文本做三类检查：
//   1) 内涵完整性：主诉/现病史/既往史/舌脉/辨证/治法/方药 要素是否齐全
//   2) 辨证逻辑：证型 → 治法 对应关系（内置常用证型映射表，演示用）
//   3) 书写规范：主诉时间要素、主语写法等（保守规则，避免误报）
// 隐私：确认自动脱敏是否生效
// 说明：输出为「辅助参考建议」，不构成诊断/处方结论（合规声明）。

// 常用证型 → 治法方向（演示版；长键优先匹配）
const SYNDROME_THERAPY = {
  '肝肾阴虚': ['滋补肝肾', '滋养肝肾', '补益肝肾', '滋阴补肾'],
  '心脾两虚': ['补益心脾', '健脾养心', '益气健脾养心'],
  '脾胃虚寒': ['温中散寒', '温中健脾', '温胃散寒', '健脾温中'],
  '肝阳上亢': ['平肝潜阳', '滋阴潜阳', '平肝熄风'],
  '气阴两虚': ['益气养阴', '益气滋阴', '气阴双补'],
  '气血两虚': ['益气养血', '气血双补', '补益气血', '益气补血', '补气养血'],
  '痰热内蕴': ['清热化痰', '清化痰热', '清肺化痰'],
  '湿热内蕴': ['清热利湿', '清利湿热', '清热化湿'],
  '脾肾阳虚': ['温补脾肾', '温肾健脾'],
  '肝郁气滞': ['疏肝理气', '疏肝解郁', '行气解郁'],
  '痰湿内阻': ['燥湿化痰', '健脾化湿', '燥湿健脾', '化痰祛湿'],
  '气虚血瘀': ['益气活血', '补气活血', '益气化瘀'],
  '风热犯肺': ['疏风清热', '辛凉解表', '清热解毒'],
  '风寒袭肺': ['疏风散寒', '祛风散寒', '宣肺散寒'],
  '肾阳亏虚': ['温补肾阳', '温阳补肾'],
  '肾阴亏虚': ['滋补肾阴', '滋阴补肾', '滋肾养阴'],
  '脾气亏虚': ['健脾益气', '益气健脾', '补中益气'],
  '肺气亏虚': ['补益肺气', '益气固表'],
  '心血亏虚': ['养心安神', '补血养心', '养血安神'],
  '肝气郁结': ['疏肝解郁', '疏肝理气', '行气解郁'],
  '气虚': ['益气', '补气', '补中益气', '健脾益气'],
  '血虚': ['补血', '养血', '滋阴养血'],
  '阴虚': ['滋阴', '养阴', '益阴', '育阴'],
  '阳虚': ['温阳', '温补', '补阳', '助阳'],
  '痰湿': ['化痰', '祛湿', '化湿', '燥湿', '健脾化湿'],
  '湿热': ['清热利湿', '清利湿热', '清热化湿', '清热燥湿'],
  '血瘀': ['活血', '化瘀', '祛瘀', '散瘀', '行血'],
  '气滞': ['行气', '理气', '疏肝理气', '宽中'],
  '风寒': ['疏风散寒', '祛风散寒', '解表散寒'],
  '风热': ['疏风清热', '清热解毒', '辛凉解表'],
  '脾虚': ['健脾', '补脾', '益气'],
  '肾虚': ['补肾', '益肾', '滋肾', '温肾'],
  '肝郁': ['疏肝', '解郁', '疏肝理气'],
};

const DISCLAIMER = '以上为规则引擎辅助提示，仅供病历书写与辨证逻辑自查参考，不构成临床诊断或处方结论。';

function has(text, labels) { return labels.some(l => String(text || '').includes(l)); }
function extract(text, re) { const m = String(text || '').match(re); return m && m[1] ? m[1].trim() : ''; }

const HAS_TIME = /(\d+(?:\.\d+)?\s*(?:天|日|周|月|年|小时|分钟|时)|反复|长期|慢性|多年|数(?:天|周|月|年)|近\s*\d+)/;

// 病历内涵要素清单：label 出现即视为“有记录”
const ELEMENTS = [
  { id: 'chief',   labels: ['主诉'],      miss: '未识别到「主诉」记录',          hint: '主诉应开门见山，含主要症状 + 持续时间，不用“患者/因”开头' },
  { id: 'history', labels: ['现病史'],    miss: '未识别到「现病史」记录',          hint: '现病史应按时间顺序描述发病经过、诊治经过与刻下症' },
  { id: 'past',    labels: ['既往史', '既往'], miss: '未识别到「既往史」记录',      hint: '补充既往疾病、手术、过敏史等内容' },
  { id: 'tongue',  labels: ['舌'],        miss: '未记录「舌象」（舌质/舌苔）',      hint: '舌象是辨证依据的重要组成部分，建议补记' },
  { id: 'pulse',   labels: ['脉'],        miss: '未记录「脉象」',                  hint: '脉象是辨证依据的重要组成部分，建议补记' },
  { id: 'zheng',   labels: ['辨证', '证型', '中医诊断'], miss: '未记录「辨证分型」', hint: '缺少辨证分型，无法体现辨证论治过程，建议按证候要素归纳' },
  { id: 'zhifa',   labels: ['治法'],      miss: '未记录「治法」',                  hint: '治法应与辨证分型对应（如：痰湿内阻 → 燥湿化痰）' },
  { id: 'fang',    labels: ['方药', '处方'], miss: '未记录「方药」',                hint: '方药应与治法一致，建议列出主方并随证加减' },
];

function runCompliance({ text, keys, sections }) {
  const masked = String(text || '');
  const items = [];

  // ---- 0) 是否有病历要素（决定是否能内涵质控）----
  const presentCnt = ELEMENTS.filter(el => has(masked, el.labels)).length;
  const hasRecord = presentCnt >= 2;
  if (!hasRecord) {
    return {
      ok: true, hasRecord: false, score: null, grade: '—',
      items: [{ cat: '提示', level: 'info', title: '未识别到结构化病历内容',
        detail: '本次抓取内容未包含主诉/现病史/辨证/治法等病历要素，无法进行内涵质控。',
        advice: '请抓取包含「主诉、现病史、舌脉、辨证、治法、方药」的病历页面，或使用框选抓取选取病历文书区域。' }],
      disclaimer: DISCLAIMER
    };
  }

  const synd = extract(masked, /(?:辨证|证型)[:：]?\s*([^\n]{2,60})/) || (keys && keys['证型']) || '';
  const zf = extract(masked, /治法[:：]?\s*([^\n]{2,60})/) || (keys && keys['治法']) || '';
  const chief = extract(masked, /主诉[:：]?\s*([^\n]{2,80})/) || (keys && keys['主诉']) || '';

  // ---- 1) 隐私脱敏确认 ----
  if (masked.includes('*')) {
    items.push({ cat: '隐私合规', level: 'info', title: '已自动脱敏',
      detail: '患者姓名、住院号/病案号、手机号等身份信息已打码（如 张*、ZY2026****），可安全用于后续处理。',
      advice: '如需人工复核原始画面，请在本机查看截图，避免将原始病历外发。' });
  } else {
    items.push({ cat: '隐私合规', level: 'info', title: '未发现需脱敏的身份标识',
      detail: '本次文本中未检测到姓名/证件号/联系方式等敏感信息。',
      advice: '若病历含患者信息，工具会自动脱敏后存档。' });
  }

  // ---- 2) 内涵完整性 ----
  let errN = 0;
  for (const el of ELEMENTS) {
    if (has(masked, el.labels)) continue;
    items.push({ cat: '内涵完整', level: 'warn', title: el.miss, detail: el.hint, advice: '请核对病历后补记该要素。' });
  }
  const missZheng = !has(masked, ['辨证', '证型', '中医诊断']);
  const missZhifa = !has(masked, ['治法']);
  if (missZheng || missZhifa) errN++;

  // ---- 3) 书写规范（保守）----
  if (chief) {
    if (/^(患者|病人|该患者|因)/.test(chief)) {
      items.push({ cat: '书写规范', level: 'warn', title: '主诉写法待改进',
        detail: `主诉以“${chief.slice(0, 14)}…”开头，主诉应直接写症状与持续时间。`,
        advice: '规范示例：反复头晕头痛 2 周。' });
    } else if (!HAS_TIME.test(chief)) {
      items.push({ cat: '书写规范', level: 'info', title: '主诉建议补充持续时间',
        detail: `当前主诉：“${chief.slice(0, 30)}” 未明确持续时间。`,
        advice: '主诉应包含时间要素，如：咳嗽、咳痰 3 天。' });
    }
  }

  // ---- 4) 辨证逻辑：证型 → 治法 ----
  if (synd && zf) {
    const entries = Object.entries(SYNDROME_THERAPY).sort((a, b) => b[0].length - a[0].length);
    const hit = entries.find(([s]) => synd.includes(s));
    if (hit) {
      const [sn, allows] = hit;
      const ok = allows.some(a => zf.includes(a));
      if (ok) {
        items.push({ cat: '辨证逻辑', level: 'info', title: '证-法对应一致',
          detail: `“${synd}” 对应的治法方向（${allows[0]} 等）已在治法中体现。`,
          advice: '请继续核对法-方一致：所选方剂是否体现该治法。' });
      } else {
        items.push({ cat: '辨证逻辑', level: 'warn', title: '证型与治法对应关系待复核',
          detail: `辨证为“${synd.slice(0, 40)}”，治法“${zf.slice(0, 40)}” 未体现“${sn}”的常规治法（如 ${allows.slice(0, 3).join('、')}）。`,
          advice: '请复核辨证与治法是否自洽（例：气血两虚 → 益气养血）。' });
      }
    } else {
      items.push({ cat: '辨证逻辑', level: 'info', title: '证-法校验：自定义证型',
        detail: `已识别辨证“${synd.slice(0, 40)}”，当前规则库未收录该证型的治法映射，未做自动比对。`,
        advice: '内置映射覆盖临床常用 20+ 证型，后续可扩展知识图谱校验。' });
    }
  } else if (synd && !zf && missZhifa) {
    items.push({ cat: '辨证逻辑', level: 'warn', title: '缺少治法，辨证论治链不完整',
      detail: '已记录辨证分型但缺少「治法」环节。',
      advice: '按“辨证 → 治法 → 方药”顺序补全，形成完整论治链。' });
  }

  // ---- 5) 得分（参考值）----
  let score = 100;
  for (const it of items) {
    if (it.level === 'error') score -= 15;
    else if (it.level === 'warn') score -= 5;
  }
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 90 ? '良好' : score >= 70 ? '待完善' : '需关注';
  const warnN = items.filter(i => i.level === 'warn').length;
  const errorN = items.filter(i => i.level === 'error').length;
  errN += warnN;

  return {
    ok: true, hasRecord: true, score, grade,
    warnN, errorN,
    items,
    disclaimer: DISCLAIMER
  };
}

module.exports = { runCompliance, SYNDROME_THERAPY };
