// scripts/expand-clinical-2.js - 扩容二批：补齐西医对照目标病种（26）
const fs = require('fs');
const path = require('path');

const DIAGS2 = [
  { name: '痛风', cat: '内科-肢体', syndromes: ['湿热蕴结证', '瘀热阻滞证', '痰浊阻滞证', '肝肾阴虚证'], note: '拇趾跖趾关节突发红肿热痛、夜间为甚，血尿酸升高。高尿酸血症/痛风性关节炎可参考。' },
  { name: '肺积', cat: '内科-肺系', syndromes: ['瘀阻肺络证', '痰湿蕴肺证', '阴虚毒热证', '气阴两虚证'], note: '肺部积块、咳嗽咯血、胸痛消瘦。肺部占位性病变须中西医结合规范诊治。' },
  { name: '乳岩', cat: '外科-乳房', syndromes: ['肝郁痰凝证', '冲任失调证', '正虚毒炽证', '气血两亏证'], note: '乳房肿块坚硬如石、表面高低不平。乳腺癌须以外科综合治疗为主。' },
  { name: '瘰疬', cat: '外科-颈部', syndromes: ['气滞痰凝证', '阴虚火旺证', '气血两虚证'], note: '颈部结核累累如贯珠。淋巴结结核/慢性淋巴结炎可参考；疗程较长。' },
  { name: '筋瘤', cat: '外科-周围血管', syndromes: ['劳倦伤气证', '寒湿凝筋证', '湿热瘀阻证'], note: '下肢筋脉色紫、盘曲突起如蚯蚓。下肢静脉曲张可参考。' },
  { name: '蛔厥', cat: '内科-虫证', syndromes: ['蛔虫上扰证', '寒热错杂证'], note: '突发上腹钻顶样绞痛、时作时止、吐蛔。胆道蛔虫症可参考。' },
  { name: '面油风', cat: '皮肤', syndromes: ['肺胃热盛证', '脾虚湿困证', '血虚风燥证'], note: '面部油腻性鳞屑、瘙痒。脂溢性皮炎可参考。' },
  { name: '日晒疮', cat: '皮肤', syndromes: ['热毒侵袭证', '湿毒蕴结证'], note: '日晒后皮肤红肿、灼热、起疱。日光性皮炎可参考。' },
  { name: '冻疮', cat: '皮肤', syndromes: ['寒凝血瘀证', '寒盛阳衰证', '瘀滞化热证'], note: '受冻部位苍白红肿、痒痛、起水疱。注意保暖复温。' },
  { name: '疥疮', cat: '皮肤', syndromes: ['虫毒侵袭证', '湿热蕴结证', '血虚风燥证'], note: '指缝腕屈侧丘疹水疱、夜间剧痒。疥螨感染，须杀虫隔离同治。' },
  { name: '鹅掌风', cat: '皮肤', syndromes: ['风湿毒聚证', '湿热下注证', '血虚风燥证'], note: '手掌角化脱屑皲裂。手癣可参考。' },
  { name: '灰指甲', cat: '皮肤', syndromes: ['虫淫甲损证', '肝血不足证'], note: '甲板增厚变脆、灰白浑浊。甲真菌病可参考。' },
  { name: '风热疮', cat: '皮肤', syndromes: ['风热蕴肤证', '血热风盛证'], note: '玫瑰色斑片、长轴与皮纹一致的领圈状脱屑。玫瑰糠疹可参考。' },
  { name: '鼻窒', cat: '五官-鼻', syndromes: ['肺经蕴热证', '肺脾气虚证', '气滞血瘀证'], note: '鼻塞日久、持续不通、嗅觉减退。慢性鼻炎可参考。' },
  { name: '鼻槁', cat: '五官-鼻', syndromes: ['燥邪伤肺证', '肺肾阴虚证', '脾气虚弱证'], note: '鼻内干燥、黏膜萎缩、鼻气腥臭。干燥性/萎缩性鼻炎可参考。' },
  { name: '白涩症', cat: '五官-眼', syndromes: ['肺阴不足证', '肝肾阴虚证', '脾虚气弱证'], note: '眼干涩不爽、瞬目频繁。干眼症可参考。' },
  { name: '圆翳内障', cat: '五官-眼', syndromes: ['肝肾不足证', '脾虚气弱证', '肝热上扰证'], note: '晶珠浑浊、视物模糊、瞳神内圆翳。老年性白内障可参考。' },
  { name: '绿风内障', cat: '五官-眼', syndromes: ['肝郁气滞证', '风火攻目证', '痰火郁结证', '阴虚风动证'], note: '眼胀欲脱、瞳神散大、视灯火有虹晕。青光眼急症须立即眼科处理。' },
  { name: '耳胀', cat: '五官-耳', syndromes: ['风邪袭肺证', '肝胆湿热证', '脾虚湿困证'], note: '耳内胀闷堵塞感、听力下降、自声增强。分泌性中耳炎可参考。' },
  { name: '牙宣', cat: '五官-口齿', syndromes: ['胃火上蒸证', '肾阴亏损证', '气血不足证'], note: '牙龈宣肿、龈肉萎缩、牙根宣露、牙齿松动渗血。牙周炎可参考。' },
  { name: '五迟五软', cat: '儿科', syndromes: ['肝肾亏损证', '心脾两虚证', '脾肾阳虚证', '痰瘀阻滞证'], note: '立迟行迟齿迟发迟语迟、头项软口软手软足软肌肉软。发育迟滞须早筛查早干预。' },
  { name: '胎黄', cat: '儿科', syndromes: ['湿热郁蒸证', '寒湿阻滞证', '气滞血瘀证', '胎黄动风证'], note: '新生儿皮肤面目发黄。生理性多可自退；病理性（胆红素升高）须光疗等处理。' },
  { name: '脏躁', cat: '内科-神志', syndromes: ['心神失养证', '肝郁化火证', '痰热扰神证'], note: '精神恍惚、悲伤欲哭、哈欠频作。癔症样发作/情志失调可参考。' },
  { name: '虫证', cat: '内科-虫证', syndromes: ['虫积肠道证', '脾胃虚弱证'], note: '脐周疼痛时作、嗜食异物、面黄肌瘦、大便排虫。肠道寄生虫病可参考。' },
  { name: '褥疮', cat: '外科-皮肤', syndromes: ['气滞血瘀证', '蕴毒腐溃证', '气血两虚证'], note: '长期受压部位皮肤溃烂坏死。压疮须定时翻身减压、清创换药。' },
  { name: '妇人腹痛', cat: '妇科', syndromes: ['肾阳虚衰证', '血虚失荣证', '湿热瘀结证', '气滞血瘀证'], note: '小腹疼痛、坠胀，经行加重。慢性盆腔疼痛可参考。' }
];

const ROOT = path.join(__dirname, '..');
const files = [
  path.join(ROOT, 'data', 'seed-diagnoses.json'),
  'C:/Users/Administrator/AppData/Roaming/岐黄鉴方·悬浮采集助手/knowledge/diagnoses.json'
];
for (const f of files) {
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { arr = []; }
  const map = new Map(arr.map(x => [x.name, x]));
  let added = 0;
  for (const d of DIAGS2) if (!map.has(d.name)) { map.set(d.name, d); added++; }
  const list = [...map.values()];
  fs.writeFileSync(f, JSON.stringify(list, null, 1), 'utf8');
  console.log(`${path.basename(path.dirname(f))}/…/diagnoses.json: +${added} → 共${list.length}`);
}

// 校验 westmap 目标闭环
const diagNames = new Set(JSON.parse(fs.readFileSync(files[1], 'utf8')).map(x => x.name));
const westmap = JSON.parse(fs.readFileSync('C:/Users/Administrator/AppData/Roaming/岐黄鉴方·悬浮采集助手/knowledge/westmap.json', 'utf8'));
const miss = westmap.filter(x => !diagNames.has(x.tcm));
console.log(miss.length ? `⚠ 仍未闭环: ${miss.map(x => x.west + '→' + x.tcm).join('；')}` : `✓ westmap ${westmap.length} 条目标全部闭环`);
