# -*- coding: utf-8 -*-
# scripts/_gif_build.py - 把 .probe/gif/<场景>/ 帧序列 + meta.json 合成 GIF
# 字幕条（底部）+ 点击涟漪 + 全局调色板；输出 .probe/gif/<场景>.gif
# 用法：python _gif_build.py [场景名|all] [--width 900] [--fps保持meta] [--out 目录]
import io, json, math, os, sys, time
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".probe", "gif")
BG = "C:/Users/Administrator/WorkBuddy/2026-09-09-10-13-42/tcm-competition/demo-shots/bg.png"
FONT = "C:/Windows/Fonts/msyh.ttc"
FONT_B = "C:/Windows/Fonts/msyhbd.ttc"

def build_one(name, width=900, out=None):
    d = os.path.join(SRC, name)
    meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
    files = sorted(f for f in os.listdir(d) if f.startswith("f") and f.endswith(".png"))
    n = len(files)
    if not n:
        print("no frames:", name); return None
    fps = meta.get("fps", 10)
    dur = max(30, round(1000 / fps))
    # 透明窗口场景（悬浮球 / 框选遮罩）：帧带 alpha，需垫 HIS 底图背景复原真实视觉
    bg_mode = meta.get("bg") or meta.get("tag") == "" and False
    if meta.get("w", 9999) < 500:
        width = min(width, meta["w"])
    scale = width / meta["w"]
    hh = round(meta["h"] * scale)
    BAR = 46
    W, H = width, hh + BAR

    f_size = 21 if W >= 700 else 15
    f_lab = ImageFont.truetype(FONT, f_size)
    f_click = ImageFont.truetype(FONT_B, 15)

    bg_im = None
    if meta.get("bg") == "his":
        # 大窗口：拉伸铺满（与放大镜 ratio 口径一致）；小窗口（悬浮球）：cover 裁剪 + 轻暗化
        src = Image.open(BG).convert("RGB")
        if W < 500:
            bw2 = int(hh * src.width / src.height)
            if bw2 >= W:
                x0 = (bw2 - W) * 2 // 5   # 偏左裁，保留病历主体
                bg_im = src.resize((bw2, hh), Image.LANCZOS).crop((x0, 0, x0 + W, hh))
            else:
                bh2 = int(W * src.height / src.width)
                bg_im = src.resize((W, bh2), Image.LANCZOS).crop((0, (bh2 - hh) // 3, W, (bh2 - hh) // 3 + hh))
            bg_im = Image.blend(bg_im, Image.new("RGB", (W, hh), (10, 20, 16)), 0.25)
        else:
            bg_im = src.resize((W, hh), Image.LANCZOS)

    # 预读帧
    frames = []
    for f in files:
        im = Image.open(os.path.join(d, f))
        if bg_im is not None:
            fr = im.convert("RGBA").resize((width, hh), Image.LANCZOS)
            base = bg_im.copy().convert("RGBA")
            base.alpha_composite(fr)
            frames.append(base.convert("RGB"))
        else:
            frames.append(im.convert("RGB").resize((width, hh), Image.LANCZOS))

    marks = meta.get("marks", [])
    clicks = meta.get("clicks", [])
    # 每帧的字幕：取 f<=当前帧 的最后一个 mark
    def label_at(i):
        lab = ""
        for m in marks:
            if m["f"] <= i: lab = m["label"]
        return lab

    gif_frames = []
    for i, im in enumerate(frames):
        canvas = Image.new("RGB", (W, H), (18, 32, 26))
        canvas.paste(im, (0, 0))
        dr = ImageDraw.Draw(canvas, "RGBA")
        # 点击涟漪：3 帧，扩散淡出
        for c in clicks:
            dt = i - c["f"]
            if 0 <= dt <= 5:
                t = dt / 5
                rad = 8 + 34 * t
                alpha = int(200 * (1 - t))
                cx, cy = round(c["x"] * scale), round(c["y"] * scale)
                dr.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=(120, 220, 160, alpha), width=4)
                dr.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], fill=(120, 220, 160, min(160, alpha)))
        # 光标（点击后常驻到下一个点击）：小箭头近似
        last = None
        for c in clicks:
            if c["f"] <= i: last = c
        if last:
            cx, cy = round(last["x"] * scale), round(last["y"] * scale)
            dr.polygon([(cx, cy), (cx, cy + 16), (cx + 4.5, cy + 11.5), (cx + 7.5, cy + 17.5), (cx + 10, cy + 16),
                        (cx + 7, cy + 10.2), (cx + 11.5, cy + 10.2)], fill=(255, 255, 255, 235), outline=(40, 60, 50, 235))
        # 底部字幕条
        lab = label_at(i)
        dr.rectangle([0, hh, W, H], fill=(16, 28, 23, 255))
        dr.line([(0, hh), (W, hh)], fill=(70, 150, 105, 255), width=2)
        if lab:
            if dr.textlength(lab, font=f_lab) > W - 12:
                while lab and dr.textlength(lab + "…", font=f_lab) > W - 12:
                    lab = lab[:-1]
                lab += "…"
            tw = dr.textlength(lab, font=f_lab)
            dr.text(((W - tw) / 2, hh + (9 if W >= 700 else 13)), lab, font=f_lab, fill=(235, 245, 238))
        gif_frames.append(canvas.quantize(colors=192, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG))

    out = out or os.path.join(SRC, name + ".gif")
    gif_frames[0].save(out, save_all=True, append_images=gif_frames[1:], duration=dur, loop=0,
                       disposal=2, optimize=True)
    sz = os.path.getsize(out)
    print(f"{name}: {n} frames {fps}fps -> {W}x{H}, {sz/1048576:.2f} MB -> {out}")
    return out

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    kw = {}
    for a in sys.argv[1:]:
        if a.startswith("--width="): kw["width"] = int(a.split("=")[1])
    names = args or ["all"]
    if names == ["all"]:
        names = sorted(x for x in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, x)) and not x.startswith("_"))
    for nm in names:
        build_one(nm, **kw)

if __name__ == "__main__":
    main()
