# -*- coding: utf-8 -*-
"""判定：GDI CopyFromScreen（capture-region.ps1）能否拍到本应用的分层窗口（悬浮球）。

结论直接决定「带标注笔迹进最终图」的修法：
  能拍到 → 改时序即可（遮罩未关时抓屏，笔迹自然进图）
  拍不到 → 必须走笔迹导出 + 合成
用法：python scripts/_dbg_bitblt.py [pid]
"""
import ctypes, ctypes.wintypes as wt, subprocess, time, sys, os
from PIL import Image

u32 = ctypes.windll.user32
u32.SetProcessDPIAware()
PY = r"C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
PS = r"E:\capture-tool\scripts\capture-region.ps1"


def wins(pid):
    out = []
    CB = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def cb(h, lp):
        if not u32.IsWindowVisible(h):
            return True
        p = wt.DWORD()
        u32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value != pid:
            return True
        r = wt.RECT()
        u32.GetWindowRect(h, ctypes.byref(r))
        out.append((h, r.left, r.top, r.right - r.left, r.bottom - r.top))
        return True

    u32.EnumWindows(CB(cb), 0)
    return out


pid = int(sys.argv[1]) if len(sys.argv) > 1 else None
if pid is None:
    import subprocess as sp
    out = sp.run(["tasklist", "/FI", "IMAGENAME eq QhjfCapture.exe", "/NH"],
                 capture_output=True, text=True).stdout.split()
    pid = int(out[1])
    print("自动取 PID =", pid)

ball = None
for _ in range(20):
    w = wins(pid)
    cands = [x for x in w if 50 <= x[3] <= 100 and 50 <= x[4] <= 100]
    if cands:
        ball = cands[0]
        break
    time.sleep(1)
if not ball:
    sys.exit("未找到悬浮球")
_, l, t, bw, bh = ball
print(f"悬浮球 {bw}x{bh} @({l},{t})")

out = os.path.join(os.environ.get("TEMP", "."), "bitblt_test.png")
subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS,
                "-X", str(l), "-Y", str(t), "-W", str(bw), "-H", str(bh), "-Out", out],
               capture_output=True)
print("截图:", out, os.path.getsize(out) if os.path.exists(out) else "无文件")
im = Image.open(out).convert("RGB")
px = im.load()
green = 0
colors = {}
for y in range(bh):
    for x in range(bw):
        r, g, b = px[x, y]
        colors[(r, g, b)] = colors.get((r, g, b), 0) + 1
        if g > 90 and g - r > 25 and g - b > 25:
            green += 1
print("绿色像素数 =", green, "/", bw * bh)
print("主要颜色 top5:", sorted(colors.items(), key=lambda k: -k[1])[:5])
print("VERDICT:", "分层窗口可被 BitBlt 拍到 → 改时序可行" if green > 50 else "BitBlt 拍不到分层窗口 → 必须导出笔迹合成")
