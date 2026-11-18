const fs = require('fs');
const p = __dirname + '/../lib/tcm.js';
let s = fs.readFileSync(p, 'utf8');
const a = `    const covRx = hitAll / herbSet.length;   // 处方中有多少药可被原方解释
    if (covRx < 0.35) continue;
    const covF = hitAll / comp.length;       // 原方被命中的比例`;
const b = `    const covRx = hitAll / herbSet.length;   // 处方中有多少药可被原方解释
    const covF = hitAll / comp.length;       // 原方被命中的比例
    // 准入三通道（满足其一）：
    //  1) 常规：处方覆盖率 >=0.35（小方/接近原方的加减）
    //  2) 成方全嵌套：原方几乎完整嵌入（hitAll>=4、缺<=1、covF>=0.8），如大复方中完整保留的二陈汤
    //  3) 大复方规则：>=14 药的复方（肿瘤/慢病），底方被大量加减稀释，放宽为 hitAll>=5、covF>=0.7、缺<=2
    if (covRx < 0.35 && !(hitAll >= 4 && missing <= 1 && covF >= 0.8) && !(herbSet.length >= 14 && hitAll >= 5 && covF >= 0.7 && missing <= 2)) continue;`;
if (!s.includes(a)) throw new Error('anchor not found');
fs.writeFileSync(p, s.split(a).join(b));
console.log('guessByComposition admission relaxed');
