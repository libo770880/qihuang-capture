# -*- coding: utf-8 -*-
# 用纯 OOXML 直接在 _work.pptx 中：
#   1) 删除现有全部「· 动图实录 / 全程演示」页
#   2) 新建 18 张统一版式的动图页（左大图 / 右要点）
#   3) 插入到「项目速览」页之后，作为第 3-20 页的「功能演示」块
import zipfile, re, os, shutil, sys
from PIL import Image

SRC = "C:/Users/Administrator/Desktop/_work.pptx"
GIFDIR = "E:/capture-tool/演示动图/"
TMP = SRC + ".tmp"

CX, CY = 12192000, 6858000          # 16:9 页面（EMU）
EMU = 12700

# ---------- 18 个动图页定义 ----------
# (gif, 标题, 副标题, 三条要点, 页脚)
PAGES = [
    ("00-全流程总览.gif", "全程演示 · 从打开到完成",
     "真实软件逐帧录制 · 放映模式自动循环播放",
     ["启动与悬浮球：一键唤醒", "框选 HIS 处方 → 进度条 → 自动跳转面板", "本地分析：辨证 · 方剂反查 · 审方"],
     "演示数据已脱敏 · 全程本地离线，数据不出医院"),
    ("01-启动与悬浮球.gif", "启动与悬浮球",
     "一枚悬浮球驻留屏幕右上角，随点随用",
     ["八大功能入口：采集 · 面板 · 辨证 · 检索 · 问药", "不改 HIS、不装服务器，拷贝即用", "悬浮球与全局热键双通道唤醒"],
     "真实软件录制 · 悬浮球与 HIS 界面合成演示"),
    ("02-框选采集.gif", "框选采集 → 自动跳转记录面板",
     "按住拖框 → 点提交 → 分析进度条 → 面板自动打开",
     ["拖框选区，8 个把手可微调", "真实进度通道：读取 → OCR → 纠错 → 审方", "入库后自动定位新记录并现场分析"],
     "真实软件录制 · 患者信息已脱敏"),
    ("03-中药药卡.gif", "中药药卡 · 框选即识药",
     "框选时点「药」即解析药味、预判方剂",
     ["识别药名直连 385 味中药库", "四向智能择位，不遮挡处方原文", "性味归经 · 功效 · 用法 · 禁忌 · 医保类别"],
     "真实软件录制 · 药卡内容取自本地知识库"),
    ("04-处方解析与审方.gif", "处方解析与安全审方",
     "每一次抓取，都过一遍「证法方药」全链核查",
     ["方剂归属推断：按组成反查并提示缺失药味", "证型逐味核对，证-方不符当场标红", "十八反十九畏 · 剂量 · 疗程 · 医保限定"],
     "真实软件录制 · 面板端一键本地分析"),
    ("05-处方点评工作台.gif", "处方点评工作台",
     "不规范 / 用药不适宜 / 超常 三分类批量点评",
     ["合理率 · 平均评分 · 问题分布仪表盘", "月度统计下钻，逐张列出扣分项", "红线阈值按本院口径配置，一键导出 CSV"],
     "真实软件录制 · Web 后台处方点评"),
    ("06-知识检索.gif", "知识检索",
     "中药 385 味 / 方剂 322 首 / 国标术语 4597 条",
     ["多字段检索：名称 · 别名 · 功效 · 拼音", "中药详情含禁忌与医保支付类别", "方剂溯源：出处 · 主治证型 · 配伍组成"],
     "真实软件录制 · 检索结果来自内置国标与药典知识"),
    ("07-数据看板.gif", "数据看板",
     "采集总量 · 科室分布 · 合规概览一屏掌握",
     ["采集总览：记录数 / 已分析 / 待处理", "科室分布下钻，定位高发问题", "审方告警趋势与建议印章分布"],
     "真实软件录制 · 数据来自本院真实使用记录（已脱敏）"),
    ("08-数据搬家.gif", "数据搬家 · 配置全部入库",
     "全部设置入库，搬家用一个文件",
     ["设置 · 知识库预设 · 纠错 · 补库队列全部入库", "配置包 .qhcfg 单文件导出 / 导入，导入前自动快照", "整库导出：记录 + 知识库 + 配置"],
     "真实软件录制 · 后台系统设置 → 数据搬家"),
    ("09-多种采集方式.gif", "多种采集方式一览",
     "面板入口 / 粘贴采集 / 拍照识别 三通道串联",
     ["粘贴：Ctrl+Alt+V，文本零误差入库", "拍照：纸质处方走同一识别管线", "各入口共用同一知识库与审方引擎"],
     "真实软件录制 · 三段拼接演示"),
    ("10-AI智能解读.gif", "AI 智能解读",
     "本地分析之上再加一层大模型推理",
     ["上下文自动带入：脱敏文本 + 规则引擎结果", "一次生成：病历质控 · 辨证推理链 · 处方点评", "真实进度条：准备 → 调用 → 渲染"],
     "真实软件录制 · AI 结论仅供辅助，须经执业医师核对"),
    ("11-医保规则与合规提示.gif", "医保规则与合规提示",
     "后台规则库 383 味饮片 × 前台自费/限定支付提示",
     ["甲 / 乙 / 丙类与自费逐味维护", "处方内自费药红色提示、限定支付蓝色提示", "审方印章同步降级为「需复核」"],
     "真实软件录制 · 医保规则库与面板合规分析"),
    ("12-OCR多引擎.gif", "OCR 多引擎",
     "识别质量决定后续审方准确性",
     ["PP-OCRv6 · RapidOCR(ONNX) · tesseract · 系统 OCR", "档位可调：tiny 最快 / medium 最全", "一键检测环境 · 一键离线安装，缺失自动回落"],
     "真实软件录制 · 后台管理 → OCR 引擎"),
    ("13-多模型接入.gif", "多模型接入",
     "云端 API 与本地推理并存，按用途分配",
     ["DeepSeek / 通义千问 / 智谱 GLM / Kimi", "本地 Ollama / LM Studio / vLLM（OpenAI 兼容）", "逐条测试连通性，内网可用数据不出院"],
     "真实软件录制 · 后台管理 → AI 设置"),
    ("14a-文字纠错.gif", "文字纠错 · 97 条形近规则",
     "内置规则库 + 机构自定义，两级纠错",
     ["获苓→茯苓 · 勾藤→钩藤 · 川穹→川芎", "纠错测试：粘一段原文实时命中正名", "本院特有错字随手补，保存即生效"],
     "真实软件录制 · 后台管理 → 文字纠错"),
    ("14b-AI补库.gif", "AI 补库 · 未匹配药名自动维护",
     "形近错字 / 库外真药 / 噪声，AI 分类处置",
     ["采集时未匹配药名自动进入队列", "AI 一键解析：纠错表 / 补录中药库 / 自动忽略", "闭环生效：下张处方自动纠正"],
     "真实软件录制 · AI 判定标注「AI 待复核」，人工可改"),
    ("09c-拍照识别.gif", "拍照识别 → 识别 → 入库",
     "纸质处方拍照，完成后自动跳转记录面板",
     ["摄像头取景，也可导入手机照片", "OCR 识别后自动入库并打开面板", "进入同一管线：脱敏 · 结构化 · 辨证 · 审方"],
     "真实软件录制 · 拍照窗与记录面板同尺寸衔接"),
    ("15-AI问药.gif", "AI 问药 · 云端智能问答",
     "悬浮球 / 托盘直达，模型可切云端或本地",
     ["辨证推理：症状 → 证型 → 治法 → 方剂", "处方追问：配伍禁忌 · 剂量 · 煎服法", "回答附本地知识库参考条目与免责边界"],
     "真实软件录制 · AI 结论仅供辅助，须经执业医师核对"),
]

TITLE_KEY = re.compile(r"动图实录|全程演示 · 一条总览")

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def para(t, sz=1300, color="17241C", bold=False, spc=600):
    b = ' b="1"' if bold else ""
    return (f'<a:p><a:pPr><a:spcBef><a:spcPts val="{spc}"/></a:spcBef></a:pPr>'
            f'<a:r><a:rPr lang="zh-CN" sz="{sz}"{b} dirty="0"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
            f'<a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/></a:rPr><a:t>{esc(t)}</a:t></a:r></a:p>')

def tb(sid, x, y, cx, cy, paras, anchor="t"):
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="T{sid}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>'
            f'<p:txBody><a:bodyPr wrap="square" anchor="{anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>'
            + "".join(paras) + '</p:txBody></p:sp>')

def rect(sid, x, y, cx, cy, color):
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="R{sid}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
            f'<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>')

def pic(sid, rid, x, y, cx, cy, name):
    return (f'<p:pic><p:nvPicPr><p:cNvPr id="{sid}" name="{esc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
            f'<p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
            f'<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')

SID_DEEP, SID_GREEN, SID_MUT, SID_BG = "123F28", "1D6F4B", "5D7067", "F4F7F5"

def build_slide_xml(gif_w, gif_h, title, sub, bullets, foot):
    # 左大图：可用区 x 0.40in..7.55in，y 0.95in..6.55in
    L, T = int(0.42 * 914400), int(1.05 * 914400)
    MAXW, MAXH = int(7.10 * 914400), int(5.35 * 914400)
    s = min(MAXW / gif_w, MAXH / gif_h)
    w, h = int(gif_w * s), int(gif_h * s)
    # 补一个浅色底板让动图有边框感
    pad = int(0.06 * 914400)
    body = []
    body.append(rect(2, L - pad, T - pad, w + pad * 2, h + pad * 2, SID_BG))
    body.append(pic(3, "rId2", L, T, w, h, "演示动图"))
    # 右侧要点区 x 7.75in
    RX = int(7.78 * 914400)
    RW = CX - RX - int(0.45 * 914400)
    body.append(rect(4, RX, int(1.18 * 914400), int(0.05 * 914400), int(0.55 * 914400), SID_GREEN))
    # 标题（左上）
    body.append(tb(5, int(0.42 * 914400), int(0.26 * 914400), int(7.4 * 914400), int(0.52 * 914400),
                   [para(title, 2400, SID_DEEP, True, 0)]))
    body.append(tb(6, int(0.42 * 914400), int(0.72 * 914400), int(7.4 * 914400), int(0.30 * 914400),
                   [para(sub, 1100, SID_MUT, False, 0)]))
    # 右栏要点
    ps = [para("功能实测", 1200, SID_GREEN, True, 0)]
    for b in bullets:
        ps.append(para("· " + b, 1150, "17241C", False, 700))
    body.append(tb(7, RX, int(1.75 * 914400), RW, int(3.9 * 914400), ps))
    # 页脚
    body.append(tb(8, int(0.42 * 914400), int(6.72 * 914400), int(11.2 * 914400), int(0.28 * 914400),
                   [para(foot, 1000, SID_MUT, False, 0)]))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/>'
            '<a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' + "".join(body) +
            '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')

# ---------- 读包 ----------
zin = zipfile.ZipFile(SRC)
files = {n: zin.read(n) for n in zin.namelist() if not n.endswith("/")}
pres = files["ppt/presentation.xml"].decode("utf8")
prels = files["ppt/_rels/presentation.xml.rels"].decode("utf8")

# 现有页序号 → 标题
slides = {}
for n in list(files):
    m = re.match(r"ppt/slides/slide(\d+)\.xml$", n)
    if m:
        slides[int(m.group(1))] = n
# presentation.xml 中的顺序
order = re.findall(r'<p:sldId id="(\d+)" r:id="(rId\d+)"/>', pres)
rel2target = {m.group(1): "ppt/" + m.group(2).lstrip("./") for m in re.finditer(r'<Relationship Id="(rId\d+)"[^>]*Target="([^"]*slide\d+\.xml)"', prels)}
seq = [rel2target[rid] for _sid, rid in order]   # 按放映顺序的 slide part 列表

def slide_title(part):
    x = files[part].decode("utf8")
    return " ".join(re.findall(r"<a:t>(.*?)</a:t>", x, re.S))

# 要删除的页：标题含「动图实录」或「全程演示 · 一条总览」
del_parts = set()
for part in seq:
    t = slide_title(part)
    if TITLE_KEY.search(t):
        del_parts.add(part)
print("删除旧动图页:", len(del_parts))

keep_seq = [p for p in seq if p not in del_parts]
anchor_part = None
for p in keep_seq:
    if "项目速览" in slide_title(p):
        anchor_part = p; break
assert anchor_part, "找不到项目速览页"
print("插入锚点:", anchor_part, slide_title(anchor_part)[:20])

# ---------- 清理被删页的残留 ----------
def part_num(p):
    return int(re.search(r"slide(\d+)\.xml$", p).group(1))

drop = set(del_parts)
for p in del_parts:
    n = part_num(p)
    rp = f"ppt/slides/_rels/slide{n}.xml.rels"
    drop.add(rp)
    if rp in files:                      # 关联的备注页
        r = files[rp].decode("utf8")
        for m in re.finditer(r'Target="\.\./notesSlides/(notesSlide\d+\.xml)"', r):
            ns = "ppt/notesSlides/" + m.group(1)
            drop.add(ns); drop.add("ppt/notesSlides/_rels/" + m.group(1) + ".rels")
for n in list(files):
    if n in drop: del files[n]

# 移除 presentation.xml 中被删页的 sldId，并清 rels
del_rel_ids = {rid for _sid, rid in order if rel2target[rid] in del_parts}
pres = re.sub(r'<p:sldId id="(\d+)" r:id="(rId\d+)"/>\s*',
              lambda m: "" if m.group(2) in del_rel_ids else m.group(0), pres)
lines = []
for line in prels.split("<Relationship"):
    mm = re.search(r'Id="(rId\d+)"', line)
    if mm and mm.group(1) in del_rel_ids:
        continue
    lines.append(line)
prels = "<Relationship".join(lines)

# ---------- 新建 18 页 ----------
maxnum = max(part_num(p) for p in seq)
max_rid = max(int(x) for x in re.findall(r'rId(\d+)', prels))
max_sid = max(int(x) for x in re.findall(r'<p:sldId id="(\d+)"', pres))

# 媒体计数 / 现有关系目标，避免重名
media_cnt = max([int(re.search(r"image(\d+)\.", n).group(1)) for n in files
                 if re.match(r"ppt/slides/media/image\d+\.", n)] or [0])

new_entries = []   # (part, rid, sldId)
for i, (gif, title, sub, bullets, foot) in enumerate(PAGES):
    maxnum += 1; max_rid += 1; max_sid += 1
    part = f"ppt/slides/slide{maxnum}.xml"
    rid = f"rId{max_rid}"
    gpath = GIFDIR + gif
    im = Image.open(gpath)          # 物理像素，按比例缩放即可（DPR 不影响版式）
    media_cnt += 1
    mname = f"image{media_cnt}.gif"
    files[f"ppt/slides/media/{mname}"] = open(gpath, "rb").read()
    files[part] = build_slide_xml(im.width, im.height, title, sub, bullets, foot).encode("utf8")
    # 关系：布局 + 图片（rId2）
    files[f"ppt/slides/_rels/slide{maxnum}.xml.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
        f'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{mname}"/>'
        '</Relationships>').encode("utf8")
    prels = prels.replace("</Relationships>",
                          f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{maxnum}.xml"/></Relationships>')
    new_entries.append((part, rid, max_sid))
print("新建动图页:", len(new_entries))

# ---------- 拼装顺序：锚点页之后一次性插入 18 页 ----------
anchor_num = part_num(anchor_part)
new_sld = "".join(f'<p:sldId id="{sid}" r:id="{rid}"/>' for _p, rid, sid in new_entries)
pres = pres.replace('<p:sldLst>', '<p:sldLst>', 1)
# 定位锚点 sldId 并追加
m = re.search(r'<p:sldId id="(\d+)" r:id="(rId\d+)"/>', pres[pres.find(anchor_part[-12:]) - 600:]) if False else None
anchor_rid = [rid for _sid, rid in order if rel2target[rid] == anchor_part][0]
pres = pres.replace(f'r:id="{anchor_rid}"/>', f'r:id="{anchor_rid}"/>' + new_sld, 1)

files["ppt/presentation.xml"] = pres.encode("utf8")
files["ppt/_rels/presentation.xml.rels"] = prels.encode("utf8")

# Content_Types：gif 声明 + 新页 Override
ct = files["[Content_Types].xml"].decode("utf8")
if 'Extension="gif"' not in ct:
    ct = ct.replace('<Default Extension="png"', '<Default Extension="gif" ContentType="image/gif"/><Default Extension="png"', 1)
for part, _rid, _sid in new_entries:
    if f'PartName="/{part}"' not in ct:
        ct = ct.replace("</Types>", f'<Override PartName="/{part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')
files["[Content_Types].xml"] = ct.encode("utf8")

# ---------- 写出 ----------
zout = zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED)
for n, d in files.items():
    zout.writestr(n, d)
zout.close(); zin.close()
shutil.move(TMP, SRC)

z = zipfile.ZipFile(SRC)
print("zip ok:", z.testzip(), "size MB:", round(os.path.getsize(SRC) / 1048576, 1))
print("slides:", len([n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)]))
