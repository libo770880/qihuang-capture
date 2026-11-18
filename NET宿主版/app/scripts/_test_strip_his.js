// 验证：HIS 中药医嘱（医保列噪声）的 OCR 输出被剔除规则清干净
const StripRules = require('E:/capture-tool/renderer/strip-rules.js');
const oldCfg = [
  '✓','√','1克*1g/g','[已核对]',
  '/^[-—_=]{3,}$/','/^\\d+[.、]\\s*/',
  '~/^共\\s*\\d+\\s*味/','/[（(]\\s*共\\d+味\\d*剂/g','/[)）]\\s*$/g'
];
const newCfg = [
  '✎',
  '/(?<!\\d\\.)\\d{0,3}\\s*%?\\s*报?\\s*[-—－]?\\s*煎法/g',
  '/(?<!\\d\\.)\\d{1,3}\\s*%(?=\\s*(?:报|煎|$|[-－]))/g',
  '/报(?=\\s*(?:[-—－]|煎法|$))/g',
  '/-\\s*(?=\\d+(?:\\.\\d+)?\\s*[gG克])/g',
  '~/^[\\s\\d.%✎✓√报煎法,，、;；:：()（）\\-—－_]*$/'
];
const cfg = oldCfg.concat(newCfg).join('\n');
const input = [
  '醋延胡索 - 12 g',
  '✎ 0 % 报 - 煎法',
  '炙淫羊藿 -12g',
  '0 %报-煎法',
  '杜仲 - 15 g ✎ 0 % 报 - 煎法',
  '细辛 -3 g',
  '炙黄芪 - 60 g 10 % 报 - 煎法 炙甘草 - 6 g 0 % 报 - 煎法',
  '土鳖虫 - 6 g 报',
  '每日1剂 水煎服 分早晚两次饭后内服',
  '共24味7剂',
  '予 0.9%氯化钠 250ml 静滴',
  '怀牛膝 - 30 g'
];
const out = StripRules.applyText(input.join('\n'), cfg);
console.log(out.join('\n'));
const has = s => out.some(l => l.includes(s));
const noiseLine = out.find(l => /(?<!0\.9)%|报|煎法|✎/.test(l));
const ok =
  has('醋延胡索 12 g') && has('炙淫羊藿 12g') && has('杜仲 15 g') && has('细辛 3 g') &&
  has('炙黄芪 60 g') && has('炙甘草 6 g') && has('土鳖虫 6 g') && has('怀牛膝 30 g') &&
  has('每日1剂 水煎服 分早晚两次饭后内服') && has('予 0.9%氯化钠 250ml 静滴') &&
  !has('共24味7剂') && !noiseLine;
console.log(ok ? 'STRIP_HIS_TEST_OK' : 'STRIP_HIS_TEST_FAIL' + (noiseLine ? ' · 残留: ' + noiseLine : ''));
process.exit(ok ? 0 : 1);
