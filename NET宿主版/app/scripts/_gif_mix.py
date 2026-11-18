# -*- coding: utf-8 -*-
# scripts/_gif_mix.py - 把多个场景片段拼成一条 GIF（统一宽度，letterbox 居中）
# 用法：python _gif_mix.py 输出名 片段1 片段2 ... [--width 900] [--dur 150]
#   片段可为 "场景名"（.probe/gif/<场景>/）或 "场景名*1.5"（放慢倍速）
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".probe", "gif")
FONT = "C:/Windows/Fonts/msyh.ttc"

def load_segment(seg):
    """返回 (frames, dur, meta, title)；seg 支持 场景名:段标题 或 场景名*倍速:段标题"""
    title = ""
    if ":" in seg:
        seg, title = seg.split(":", 1)
    speed = 1.0
    name = seg
    if "*" in seg:
        name, k = seg.split("*", 1)
        speed = float(k)
    d = os.path.join(SRC, name)
    meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
    files = sorted(f for f in os.listdir(d) if f.startswith("f") and f.endswith(".png"))
    dur = max(30, round(1000 / meta.get("fps", 10) * speed))
    return [Image.open(os.path.join(d, f)) for f in files], dur, meta, title

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    kw = dict(width=900, dur=150, height=600)
    for a in sys.argv[1:]:
        if a.startswith("--width="): kw["width"] = int(a.split("=")[1])
        if a.startswith("--dur="): kw["dur"] = int(a.split("=")[1])
        if a.startswith("--height="): kw["height"] = int(a.split("=")[1])
    out_name, segs = args[0], args[1:]
    assert len(segs) >= 1, "至少一个片段"

    W, Ht = kw["width"], kw["height"]
    loaded = []
    for s in segs:
        frames, dur, meta, title = load_segment(s)
        # 高度对齐：各段缩放到统一高度，且不超画布宽（小窗允许适度放大，上限 1.5x）
        # 注意帧是物理像素（DPR），目标尺寸必须按 meta 的 CSS 尺寸换算
        scale = min(Ht / meta["h"], W / meta["w"], 1.5)
        tw, th = round(meta["w"] * scale), round(meta["h"] * scale)
        loaded.append((frames, dur, tw, th, title))
    BAR = 46
    H, Hfull = Ht, Ht + BAR
    f_size = 21 if W >= 700 else 15
    f_lab = ImageFont.truetype(FONT, f_size)

    out_frames, out_durs = [], []
    for frames, dur, tw, th, title in loaded:
        for i, im in enumerate(frames):
            canvas = Image.new("RGB", (W, Hfull), (14, 26, 21))
            fr = im.convert("RGB").resize((tw, th), Image.LANCZOS)
            canvas.paste(fr, ((W - tw) // 2, (H - th) // 2))
            dr = ImageDraw.Draw(canvas, "RGBA")
            dr.rectangle([0, H, W, Hfull], fill=(16, 28, 23, 255))
            dr.line([(0, H), (W, H)], fill=(70, 150, 105, 255), width=2)
            if title:
                lab = title
                if dr.textlength(lab, font=f_lab) > W - 12:
                    while lab and dr.textlength(lab + "…", font=f_lab) > W - 12:
                        lab = lab[:-1]
                    lab += "…"
                lw = dr.textlength(lab, font=f_lab)
                dr.text(((W - lw) / 2, H + (9 if W >= 700 else 13)), lab, font=f_lab, fill=(235, 245, 238))
            out_frames.append(canvas.quantize(colors=192, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG))
            # 每段首帧多停 120ms，段间轻微呼吸感（过长会显得拖沓）
            out_durs.append(dur + (120 if i == 0 else 0))

    out = os.path.join(SRC, out_name + ".gif")
    out_frames[0].save(out, save_all=True, append_images=out_frames[1:], duration=out_durs, loop=0, disposal=2, optimize=True)
    print(f"{out_name}: {len(out_frames)} frames from {len(segs)} segs, {os.path.getsize(out)/1048576:.2f} MB -> {out}")

if __name__ == "__main__":
    main()
