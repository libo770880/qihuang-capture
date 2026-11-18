# -*- coding: utf-8 -*-
# 补齐剩余 10 个演示动图页（工作副本 _work.pptx，空白页 25..34），建好后移动到目标位置
import subprocess, json, sys

SD = "C:/Users/Administrator/.workbuddy/plugins/cache/workbuddy-builtin/workbuddy-pptx/5.8.3-wb.41334564.gdb0e9b51.h4da087921e4a/skills/workbuddy-pptx"
F = "C:/Users/Administrator/Desktop/_work.pptx"
GIF = "E:/capture-tool/演示动图/"
DEEP, GREEN, SOFT, MUT = "123F28", "1D6F4B", "E7F1EB", "5D7067"
YH = "微软雅黑"

def call(tool, kw, quiet=False):
    r = subprocess.run(["python", f"{SD}/scripts/edsdk.py", "call", tool, "--json", json.dumps(kw, ensure_ascii=False)],
                       capture_output=True, text=True, encoding="utf-8")
    out = (r.stdout or "") + (r.stderr or "")
    if '"ok": false' in out or r.returncode != 0:
        print(f"[FAIL] {tool} {kw.get('page_index')}\n{out[:500]}"); sys.exit(1)
    if not quiet: print(f"[ok] {tool} p{kw.get('page_index')}")
    return out

def text(page, x, y, w, h, t, size=13, color="17241C"):
    call("slide_add_text", dict(file_id=F, page_index=page, x=x, y=y, w=w, h=h, text=t,
                                font_size=int(size), font_color=color, font_name=YH), quiet=True)

def rect(page, x, y, w, h, fill):
    call("slide_add_shape", dict(file_id=F, page_index=page, x=x, y=y, w=w, h=h,
                                 fill_color=fill, shape_type="rect"), quiet=True)

def img(page, path, x, y, w, h):
    call("slide_add_image", dict(file_id=F, page_index=page, x=x, y=y, w=w, h=h, image=path), quiet=True)

def title(page, t, sub=""):
    text(page, 40, 22, 880, 36, t, size=24, color=DEEP)
    rect(page, 40, 64, 110, 4, GREEN)
    if sub: text(page, 160, 58, 760, 22, sub, size=11, color=MUT)

def footer(page, t):
    text(page, 40, 512, 880, 20, t, size=10, color=MUT)

def notes(page, t):
    call("slide_add_notes", dict(file_id=F, page_index=page, text=t), quiet=True)

# (空白页索引, 标题, 副标题, GIF, 要点列表, 页脚)
PAGES = [
    (25, "启动与悬浮球 · 动图实录", "一枚悬浮球驻留屏幕右上角，随点随用",
     "01-启动与悬浮球.gif",
     ["八大功能入口\n粘贴采集 · 框选抓取 · 拍照识别\n记录面板 · 辨证咨询 · 知识检索\nAI 问药 · 后台管理",
      "不改动 HIS\n不装服务器 · 不做接口对接\n拷贝即用，医生习惯零改变",
      "热键唤醒\n悬浮球与全局热键双通道\n看病途中一步调出"],
     "动图为真实软件逐帧录制 · 悬浮球与 HIS 界面合成演示"),
    (26, "中药药卡 · 动图实录", "框选时点「药」即解析药味、预判方剂",
     "03-中药药卡.gif",
     ["即时匹配\n识别出的药名直接连到 385 味中药库",
      "四向智能择位\n药卡自动避开选区与工具条\n不遮挡处方原文",
      "一眼读完\n性味归经 · 功效 · 用法用量\n禁忌 · 医保支付类别"],
     "动图为真实软件逐帧录制 · 药卡内容取自本地知识库"),
    (27, "知识检索 · 动图实录", "中药 385 味 / 方剂 322 首 / 国标术语 4597 条",
     "06-知识检索.gif",
     ["多字段检索\n名称 · 别名 · 功效 · 拼音首字母",
      "中药详情\n药性 · 功效 · 用法 · 医保类别\n禁忌与配伍提示",
      "方剂溯源\n出处 · 主治证型 · 配伍组成\n随证加减提示"],
     "动图为真实软件逐帧录制 · 检索结果来自内置国标与药典知识"),
    (28, "数据看板 · 动图实录", "采集总量 · 科室分布 · 合规概览一屏掌握",
     "07-数据看板.gif",
     ["采集总览\n记录数 · 已分析数 · 待处理数",
      "科室分布\n按科室下钻，定位高发问题",
      "合规概览\n审方告警趋势 · 建议印章分布"],
     "动图为真实软件逐帧录制 · 看板数据来自本院真实使用记录（已脱敏）"),
    (29, "数据搬家 · 动图实录", "全部设置入库，搬家用一个文件",
     "08-数据搬家.gif",
     ["配置全部入库\n设置 · 知识库预设 · 纠错规则\n补库队列 · 清理规则",
      "配置包导出 / 导入\n.qhcfg 单文件，跨机器一键还原\n导入前自动快照",
      "整库导出\n记录 + 知识库 + 配置\n数据主权在医院"],
     "动图为真实软件逐帧录制 · 后台系统设置 → 数据搬家"),
    (30, "AI 智能解读 · 动图实录", "本地分析之上再加一层大模型推理",
     "10-AI智能解读.gif",
     ["上下文自动带入\n脱敏文本 + 规则引擎结果",
      "三项一次生成\n病历内涵质控 · 辨证推理链\n处方点评与患者教育",
      "真实进度条\n准备 → 调用 → 渲染\n非黑盒等待，可解释可复核"],
     "动图为真实软件逐帧录制 · AI 结论仅供辅助，须经执业医师核对"),
    (31, "OCR 多引擎 · 动图实录", "识别质量决定后续审方准确性",
     "12-OCR多引擎.gif",
     ["五档引擎可选\nPP-OCRv6 · RapidOCR(ONNX)\ntesseract 离线 · 系统 OCR · 自动择优",
      "档位可调\ntiny 最快 / medium 最全",
      "环境自检\n一键检测 · 一键离线安装\n环境缺失自动回落"],
     "动图为真实软件逐帧录制 · 后台管理 → OCR 引擎"),
    (32, "文字纠错 · 动图实录", "97 条内置形近错字规则 + 机构自定义",
     "14a-文字纠错.gif",
     ["内置规则库\n获苓→茯苓 · 勾藤→钩藤 · 川穹→川芎",
      "纠错测试\n粘一段识别原文，实时命中正名",
      "自定义规则\n本院 HIS 特有错字随手补\n保存即生效，不改代码"],
     "动图为真实软件逐帧录制 · 后台管理 → 文字纠错"),
    (33, "AI 补库 · 动图实录", "未匹配药名自动进入队列，AI 分类处置",
     "14b-AI补库.gif",
     ["自动归集\n采集时未匹配到库的药名进入队列",
      "AI 一键解析\n形近错字 → 纠错表\n库外真药 → 补录中药库\n用法噪声 → 自动忽略",
      "闭环生效\n纠错表更新后，下张处方自动纠正"],
     "动图为真实软件逐帧录制 · AI 判定结果标注「AI 待复核」，人工可改"),
    (34, "拍照识别 · 动图实录", "纸质处方拍照 → 识别 → 入库分析",
     "09c-拍照识别.gif",
     ["摄像头取景\n对准纸质处方，也可导入手机照片",
      "OCR 识别\n完成后自动入库并跳转记录面板",
      "进入同一管线\n脱敏 · 结构化 · 辨证 · 审方"],
     "动图为真实软件逐帧录制 · 拍照窗与记录面板同尺寸衔接"),
]

for page, t, sub, gif, bullets, foot in PAGES:
    title(page, t, sub)
    img(page, GIF + gif, 30, 84, 568, 400)
    text(page, 622, 96, 300, 380, "\n\n".join(bullets), size=12, color="17241C")
    footer(page, foot)
    notes(page, "本页为动图（" + gif.replace(".gif", "") + "），放映模式下自动循环播放。")
    print("built page", page, t)

# 移动到位：目标位置（插入前）从左到右逐页插入，每次插完索引右移
MOVES = [
    (25, 5),    # 启动悬浮球 → 政策页之后、产品理念页之前
    (26, 13),   # 中药药卡 → 辨证咨询页之前
    (27, 18),   # 知识检索 → 审方规则页之前
    (28, 19),   # 数据看板
    (29, 20),   # 数据搬家
    (30, 21),   # AI解读
    (31, 24),   # OCR
    (32, 27),   # 文字纠错
    (33, 28),   # AI补库
    (34, 30),   # 拍照识别
]
for frm, to in MOVES:
    call("slide_move_slide", dict(file_id=F, page_indexes=[frm], before_slide_index=to), quiet=True)
    print("moved", frm, "->", to)

call("save_file", dict(file_id=F))
print("done")
