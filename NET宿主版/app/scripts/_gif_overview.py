# -*- coding: utf-8 -*-
# scripts/_gif_overview.py - 把各功能场景抽帧串联成一条「从打开到完成」总览 GIF
# 均匀抽帧 + 统一画布 900x588 + 场景标题字幕，输出 .probe/gif/00-全流程总览.gif
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".probe", "gif")
BG = "C:/Users/Administrator/WorkBuddy/2026-09-09-10-13-42/tcm-competition/demo-shots/bg.png"
FONT = "C:/Windows/Fonts/msyh.ttc"

PLAN = [
    ("01-启动与悬浮球", "启动悬浮球 · 一键唤醒", 16),
    ("02-框选采集", "框选 HIS 处方区域 · 一键入库", 18),
    ("03-中药药卡", "「药」实时识别药味与预判方剂", 16),
    ("04-处方解析与审方", "一键本地分析 · 辨证/方剂反查/审方", 20),
    ("10-AI智能解读", "AI 智能解读 · 质控+辨证+点评", 16),
    ("11b-医保合规提示", "医保规则 · 自费/限定支付提示", 16),
    ("05-处方点评工作台", "批量点评 · 三分类仪表盘", 18),
    ("06-知识检索", "知识库全库检索", 14),
    ("07-数据看板", "采集与合规数据看板", 14),
    ("08-数据搬家", "配置全部入库 · 单文件搬家", 14),
]

W, H, BAR = 900, 588, 46
# 节奏：每段 ~5-7 秒（280ms/帧 + 段首 1.1s 停顿），一眼能看清再切下一段
DUR, HEAD_DUR = 280, 1100

def take(d, n):
    files = sorted(f for f in os.listdir(d) if f.startswith("f") and f.endswith(".png"))
    if not files:
        return []
    idxs = [round(i * (len(files) - 1) / max(1, n - 1)) for i in range(n)]
    return [os.path.join(d, files[i]) for i in idxs]

def main():
    bg_full = Image.open(BG).convert("RGB")
    f_lab = ImageFont.truetype(FONT, 21)
    frames, durs = [], []
    for name, label, n in PLAN:
        d = os.path.join(SRC, name)
        meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
        his = meta.get("bg") == "his"
        for k, fp in enumerate(take(d, n)):
            im = Image.open(fp)
            s = min(W / im.width, H / im.height)
            nw, nh = round(im.width * s), round(im.height * s)
            canvas = Image.new("RGB", (W, H + BAR), (14, 26, 21))
            if his:
                b = bg_full.resize((W, H), Image.LANCZOS)
                base = b.convert("RGBA")
                base.alpha_composite(im.convert("RGBA").resize((nw, nh), Image.LANCZOS))
                canvas.paste(base.convert("RGB"), (0, 0))
            else:
                canvas.paste(im.convert("RGB").resize((nw, nh), Image.LANCZOS), ((W - nw) // 2, (H - nh) // 2))
            dr = ImageDraw.Draw(canvas, "RGBA")
            dr.rectangle([0, H, W, H + BAR], fill=(16, 28, 23))
            dr.line([(0, H), (W, H)], fill=(70, 150, 105), width=2)
            tw = dr.textlength(label, font=f_lab)
            dr.text(((W - tw) / 2, H + 9), label, font=f_lab, fill=(235, 245, 238))
            frames.append(canvas.quantize(colors=192, method=Image.MEDIANCUT))
            durs.append(HEAD_DUR if k == 0 else DUR)
    out = os.path.join(SRC, "00-全流程总览.gif")
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durs, loop=0, disposal=2, optimize=True)
    print(f"overview: {len(frames)} frames -> {os.path.getsize(out)/1048576:.2f} MB -> {out}")

if __name__ == "__main__":
    main()
