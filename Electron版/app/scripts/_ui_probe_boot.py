# -*- coding: utf-8 -*-
"""启动行为实测：1) 首次启动默认无记录面板；2) 面板打开时居中。
用法：python scripts/_ui_probe_boot.py [exe路径]
"""
import ctypes, ctypes.wintypes as wt, subprocess, time, sys, os

u32 = ctypes.windll.user32
u32.SetProcessDPIAware()
EXE = sys.argv[1] if len(sys.argv) > 1 else \
    r"E:\capture-tool\net\QhjfCapture\bin\Release\net8.0-windows10.0.17763.0\QhjfCapture.exe"
ENV = dict(os.environ, APPDATA=r"C:\Users\Administrator\AppData\Roaming",
           DOTNET_ROOT=r"C:\Users\Administrator\.workbuddy\binaries\dotnet")

def log(*a): print(*a); sys.stdout.flush()

def enum_windows(pid):
    out = []
    CB = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(h, lp):
        if not u32.IsWindowVisible(h): return True
        p = wt.DWORD()
        u32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value != pid: return True
        r = wt.RECT()
        u32.GetWindowRect(h, ctypes.byref(r))
        out.append((h, r.left, r.top, r.right - r.left, r.bottom - r.top))
        return True
    u32.EnumWindows(CB(cb), 0)
    return out

def find_ball(pid, lo=60, hi=95):
    for w in enum_windows(pid):
        if lo <= w[3] <= hi and lo <= w[4] <= hi: return w
    return None

MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004
def click(x, y):
    u32.SetCursorPos(x, y); time.sleep(0.12)
    u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); time.sleep(0.07)
    u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0); time.sleep(0.2)

SW, SH = u32.GetSystemMetrics(0), u32.GetSystemMetrics(1)

proc = subprocess.Popen([EXE], cwd=os.path.dirname(EXE), env=ENV)
log("PID =", proc.pid)
time.sleep(8)

# 1) 启动后不应有大面板窗口（panel 1100x720 DIP ≈ 1375x900 物理）
panel0 = [w for w in enum_windows(proc.pid) if w[3] > 1000 and w[4] > 700]
log("RESULT boot-panel =", "FAIL 启动即有面板" if panel0 else "OK 启动无面板")

# 2) 展开球 → 点第一项「记录面板」→ 应出现且居中
ball = find_ball(proc.pid)
if not ball:
    log("FAIL: 未找到悬浮球"); os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1"); sys.exit(1)
h, bl, bt, bw, bh = ball
click(bl + bw // 2, bt + bh // 2)
time.sleep(1.0)
exp = find_ball(proc.pid, lo=100, hi=700)
if not exp:
    log("FAIL: 未展开"); os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1"); sys.exit(1)
eh, el, et, ew, eh2 = exp[0], exp[1], exp[2], exp[3], exp[4]
sf = ew / 214.0
item_h = (eh2 - int(42*sf) - int(8*sf) - 8*int(4*sf) - int(36*sf)) / 8.0
# 精确布局（HTML）：head≈40 DIP + items padding 2 + item 高≈44 / gap 4 → 第 4 项中心 ≈208 DIP
# （第 1-4 项：粘贴采集 / 框选抓取 / 框选识字 / 记录面板）
btn_y = et + int(208 * sf)
log(f"点击『记录面板』: ({el + int(ew/2)},{btn_y})")
click(el + int(ew / 2), btn_y)

panel = None
for _ in range(8):
    time.sleep(0.8)
    for w in enum_windows(proc.pid):
        # panel = 1100x720 DIP ≈ 1375x900 物理（consult 是 1300x975，须排除）
        if 1330 <= w[3] <= 1420 and 860 <= w[4] <= 940:
            panel = w; break
    if panel: break
if not panel:
    log("RESULT open-panel = FAIL 面板未出现")
else:
    h2, pl, pt, pw, ph = panel
    cx, cy = pl + pw / 2, pt + ph / 2
    dx, dy = cx - SW / 2, cy - SH / 2
    log(f"面板 {pw}x{ph} @({pl},{pt})  中心偏差 dx={dx:.0f} dy={dy:.0f} (屏幕 {SW}x{SH})")
    ok = abs(dx) < 60 and abs(dy) < 60
    log("RESULT panel-center =", "OK 居中" if ok else "FAIL 偏离")

os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1")
log("--- 测毕 ---")
