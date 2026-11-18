# -*- coding: utf-8 -*-
# 向大赛路演 PPT 追加 6 页（动图演示 x4 + AI研发账本 + 团队页），再统一切入目标位置
# 用法：python _ppt_add_pages.py
import subprocess, sys, json

SD = "C:/Users/Administrator/.workbuddy/plugins/cache/workbuddy-builtin/workbuddy-pptx/5.8.3-wb.41334564.gdb0e9b51.h4da087921e4a/skills/workbuddy-pptx"
F = "C:/Users/Administrator/Desktop/平原县中医院岐黄鉴方工具(1).pptx"
GIF = "E:/capture-tool/演示动图/"

DEEP = "123F28"; GREEN = "1D6F4B"; SOFT = "E7F1EB"; MUT = "5D7067"; LINE = "DCE5E0"
YH = "微软雅黑"

def call(tool, kw):
    r = subprocess.run(["python", f"{SD}/scripts/edsdk.py", "call", tool, "--json", json.dumps(kw, ensure_ascii=False)], capture_output=True, text=True, encoding="utf-8")
    out = (r.stdout or "") + (r.stderr or "")
    if '"ok": false' in out or r.returncode != 0:
        print(f"[FAIL] {tool} {kw}\n{out[:800]}")
        sys.exit(1)
    return out

def text(page, x, y, w, h, t, size=13, color="17241C", align=None):
    kw = dict(file_id=F, page_index=page, x=x, y=y, w=w, h=h, text=t,
              font_size=int(size), font_color=color, font_name=YH)
    return call("slide_add_text", kw)

def rect(page, x, y, w, h, fill, alpha=0):
    return call("slide_add_shape", dict(file_id=F, page_index=page, x=x, y=y, w=w, h=h,
                fill_color=fill, fill_alpha=alpha, shape_type="rect"))

def img(page, path, x, y, w, h):
    return call("slide_add_image", dict(file_id=F, page_index=page, x=x, y=y, w=w, h=h, image=path))

def title(page, t, sub=""):
    text(page, 40, 22, 880, 36, t, size=24, color=DEEP)
    rect(page, 40, 64, 110, 4, GREEN)
    if sub:
        text(page, 160, 58, 760, 22, sub, size=11, color=MUT)

def footer(page, t):
    text(page, 40, 512, 880, 20, t, size=10, color=MUT)

def notes(page, t):
    return call("slide_add_notes", dict(file_id=F, page_index=page, text=t))

# ---------- A(19) 已建，跳过 ----------
    if False:
    	P = 19
    	title(P, "全程演示 · 一条总览", "真实软件逐帧录制 · 放映模式自动循环播放")
    	img(P, GIF + "00-全流程总览.gif", 30, 84, 568, 400)
    	text(P, 622, 96, 300, 380,
    	     "① 启动与悬浮球：一键唤醒\n\n"
    	     "② 框选 HIS 处方：提交 → 分析进度条 → 自动跳转记录面板\n\n"
    	     "③ 一键本地分析：辨证 · 方剂反查 · 安全审方\n\n"
    	     "④ AI 智能解读 · 医保合规提示\n\n"
    	     "⑤ 批量点评 · 知识检索 · 数据看板\n\n"
    	     "⑥ 配置全部入库 · 单文件搬家", size=13, color="17241C")
    	footer(P, "演示数据已脱敏 · 全程本地离线，数据不出医院")
    	notes(P, "本页为动图：放映模式下自动循环播放。总览涵盖启动→采集→分析→点评→看板→搬家全流程。")


# ---------- B(20) 四条采集通道：02 ----------
P = 20
title(P, "四条采集通道 · 动图实录", "示例：框选 HIS 处方区域 → 一键入库")
img(P, GIF + "02-框选采集.gif", 36, 86, 592, 400)
text(P, 652, 96, 272, 400,
     "粘贴采集\nCtrl+Alt+V，文本零误差入库\n\n"
     "框选抓取\n提交 → 分析进度条 → 自动跳转记录面板\n\n"
     "屏幕文字\n离线 UIA 识字，绿屏老系统也能采\n\n"
     "拍照识别\n纸质处方走同一管线\n\n"
     "采集即脱敏 · 识别即纠错", size=12, color="17241C")
footer(P, "动图为真实软件逐帧录制 · 患者信息已脱敏")
notes(P, "本页为动图：完整展示框选→提交→进度条→跳转面板→现场本地分析。")

# ---------- C(21) 识别→辨证→审方：04 + 05 ----------
P = 21
title(P, "识别 → 辨证 → 审方 · 动图实录", "每一次抓取，都过一遍「证法方药」全链核查")
img(P, GIF + "04-处方解析与审方.gif", 36, 88, 430, 303)
text(P, 36, 398, 430, 60, "左：一键本地分析——方剂归属推断 · 证型逐味核对 · 十八反/剂量/疗程安全审方", size=11, color=MUT)
img(P, GIF + "05-处方点评工作台.gif", 494, 88, 430, 300)
text(P, 494, 398, 430, 60, "右：处方点评工作台——不规范/不适宜/超常三分类 · 合理率仪表盘 · 月度下钻 · 一键导出", size=11, color=MUT)
text(P, 36, 462, 890, 40, "点评结论支持人工裁定与全程留痕，CSV 直接进质控月报；红线阈值（味数/剂量/剂数/相符率）按本院口径后台可调。", size=12, color="17241C")
notes(P, "本页两段动图：左侧面板端分析，右侧 Web 后台点评。放映时自动循环。")

# ---------- D(22) AI 问药：15 ----------
P = 22
title(P, "AI 问药 · 云端智能问答", "悬浮球 / 托盘直达 · 模型可切云端或本地")
img(P, GIF + "15-AI问药.gif", 470, 82, 470, 400)
text(P, 40, 96, 410, 400,
     "辨证推理\n症状 → 证型 → 治法 → 方剂，回答附本地知识库参考条目\n\n"
     "处方追问\n配伍禁忌 · 剂量核查 · 煎服法 · 患者用药教育\n\n"
     "真实里程碑进度\n上下文 → 调用 → 渲染，不是黑盒等待\n\n"
     "边界清晰\nAI 结论仅供辅助，须经执业医师核对\n\n"
     "内网可用\n云端 API / 本地化部署可切换，数据不出院", size=12, color="17241C")
notes(P, "本页为动图：两轮真实问答（辨证推理 + 处方安全追问），进度条为真实里程碑。")

# ---------- E(23) AI 研发账本：token ----------
P = 23
title(P, "AI 研发账本：token 消耗与工程纪律", "研发费用 ≈ token 费用，零专职程序员")
cards = [
    ("93 亿", "tokens 累计消耗", "需求澄清 · 编码 · 对拍全流程"),
    ("7.9 万", "轮 AI 对话", "WorkBuddy 账号全量统计"),
    ("5.9 万行", "代码 · 207 个源文件", "Electron + .NET 8 双技术栈"),
    ("135 组", "跨语言对拍零差异", "+ 60 项自动自检全过"),
]
pos = [(40, 96), (272, 96), (40, 218), (272, 218)]
for (num, lab, sub), (x, y) in zip(cards, pos):
    rect(P, x, y, 216, 106, SOFT)
    text(P, x + 14, y + 10, 190, 34, num, size=24, color=DEEP)
    text(P, x + 14, y + 50, 190, 22, lab, size=11.5, color="17241C")
    text(P, x + 14, y + 74, 190, 26, sub, size=9.5, color=MUT)
img(P, GIF + "13-多模型接入.gif", 520, 96, 404, 282)
text(P, 520, 384, 404, 40, "多模型接入：云端 API / 本地 Ollama 可切换，按用途分配，内网可用", size=11, color=MUT)
text(P, 40, 340, 460, 160,
     "token 消耗结构：约六成用于双栈对拍与回归自检——\nAI 写的代码，用工程手段保证确定性。\n\n"
     "零专职研发投入，功能以周推进；\n规则永远由最懂药的人（药师/医生）定义。", size=12, color="17241C")
footer(P, "数据口径：WorkBuddy 账号全量统计（截至 2026-10）")
notes(P, "回应「没有程序员怎么做软件」：token 即研发成本，账本可查；对拍与自检保证 AI 代码质量。")

# ---------- F(24) 团队：六个临床人 ----------
P = 24
title(P, "团队：六个临床人，零计算机专业", "临床一线团队 × AI 工程化实现")
team = [
    ("药 · 药剂科药师", "审方规则与知识库的源头：十八反十九畏、剂量上限、医保限定、形近纠错，全部出自药房一线经验。"),
    ("医 · 临床医生", "辨证质控逻辑的定义者：四诊要素规范、证-法-方-药自洽校验；用真实出诊场景做需求与验收。"),
    ("AI · 全部软件工程", "桌面端 / OCR 管线 / 知识库 / 审方引擎全部由 AI 编码：5.9 万行代码，周级迭代，零专职研发成本。"),
]
for i, (h, b) in enumerate(team):
    x = 40 + i * 300
    rect(P, x, 96, 280, 170, SOFT)
    text(P, x + 16, 108, 250, 28, h, size=14, color=DEEP)
    text(P, x + 16, 142, 250, 116, b, size=10.5, color="17241C")
text(P, 40, 292, 890, 130,
     "产品逻辑来自诊室，不来自想象——悬浮窗不挡病历、提示一行读完、导出直接进月报，每个交互都来自真实出诊场景的取舍。\n\n"
     "AI 编程也有工程纪律：双技术栈逐字镜像、135 组跨语言场景零差异、60 项自检全过——AI 写的代码，用工程手段保证确定性。\n\n"
     "我们不做写代码的团队——我们做定义「对错」的团队；代码，交给 AI。", size=12, color="17241C")
footer(P, "核心成员 ≤ 7 人，符合创业团队组要求 · 知识产权归团队核心成员所有")
notes(P, "融合自《岐黄鉴方路演》团队页：六个临床人 + AI 编程范式 + 工程纪律。")

# ---------- 移动到位 ----------
moves = [(19, 2), (20, 8), (21, 11), (22, 13), (23, 17), (24, 22)]
for frm, to in moves:
    call("slide_move_slide", dict(file_id=F, page_indexes=[frm], before_slide_index=to))

print("all done")
