// lib/noise.js - HIS 界面噪声行过滤：剔除表单字段标签、纯符号/数字行、单字碎片
// 设计原则：只做确定性剔除（整行精确命中标签表/无文字内容），绝不误删含真实语义的长行

// 医院信息系统（HIS/EMR）常见界面字段标签与按钮文案（整行精确匹配）
const UI_LABELS = new Set([
  // 医嘱录入列头
  '医嘱名称', '药品名称', '项目名称', '名称', '规格', '剂量', '单位', '频次', '频率', '用法', '用法用量',
  '给药途径', '途径', '滴速', '每日次数', '次数', '天数', '数量', '单价', '金额', '合计', '总量',
  '首日', '特殊属性', '自备', '皮试', '组号', '脚注', '备注', '嘱托', '下嘱时间', '下嘱医生', '开始时间',
  '停止时间', '开始', '停止', '停嘱', '作废', '校对', '双签名', '审核', '审核人', '签名', '执行科室',
  '执行状态', '执行时间', '状态', '类型', '医嘱类型', '医嘱状态', '医嘱内容', '长期', '临时',
  '输入', '录入', '保存', '提交', '删除', '修改', '新增', '取消', '确定', '关闭', '打印', '查询',
  '导出', '导入', '刷新', '返回', '搜索', '筛选', '全选', '反选',
  // 患者信息条
  '科室', '病区', '床号', '床位', '住院号', '门诊号', '病案号', '姓名', '性别', '年龄', '日期', '时间',
  '入院日期', '出院日期', '过敏史',
  // 界面分组/标签页
  '长期医嘱', '临时医嘱', '全部', '未停', '已停', '草签', '签署', '待审', '已审', '其它', '其他', '暂无', '无数据'
]);

// 单字符白名单（虽为单字但有独立语义，不删）
const SINGLE_KEEP = new Set(['否', '有', '无', '男', '女']);

/** 判断一行 OCR 文本是否为界面噪声（标签/按钮/纯符号/碎片），应从采集文本中剔除 */
function isNoiseLine(raw) {
  const t = String(raw || '').trim();
  if (!t) return true;
  // 无任何文字（纯数字/符号/单位，如 "---"、"| |"、"21"）
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(t)) return true;
  // 单字碎片（"因"、"输"）——白名单除外
  if ([...t].length === 1) return !SINGLE_KEEP.has(t);
  // 整行就是界面标签
  if (UI_LABELS.has(t)) return true;
  // 整行由 ≥2 个标签词拼接而成（OCR 把整列标签识别成一行 "规格 剂量 频次 首日"）
  const tokens = t.split(/[\s、，,;；|·]+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.every(x => UI_LABELS.has(x))) return true;
  // HIS 处方表格规格列（"1克*1g/g"、"10g*1g/g"）：整行剔除——
  // 它是每行都有的列值，不剔会隔断"药名⏎剂量"竖排配对（党参/20g 分家），还会被误当药名"克*"
  if (/^\d+\s*克\s*\*\s*\d+\s*g\s*\/\s*g$/i.test(t)) return true;
  return false;
}

/** 过滤多行文本：逐行剔除噪声行，返回 { text, removed } */
function filterNoiseText(text) {
  const lines = String(text || '').split('\n');
  const kept = [], removed = [];
  for (const l of lines) {
    if (isNoiseLine(l)) { if (l.trim()) removed.push(l.trim()); continue; }
    kept.push(l);
  }
  return { text: kept.join('\n'), removed };
}

module.exports = { isNoiseLine, filterNoiseText, UI_LABELS };
