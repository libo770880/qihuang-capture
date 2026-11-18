# -*- coding: utf-8 -*-
"""交互调试 2：SetForegroundWindow + SendInput 点击浮球，看是否展开。"""
import ctypes, ctypes.wintypes as wt, sys, time, os, subprocess

u32 = ctypes.windll.user32
u32.SetProcessDPIAware()
APPDATA = r"C:\Users\Administrator\AppData\Roaming"
ENV = dict(os.environ, APPDATA=APPDATA, DOTNET_ROOT=r"C:\Users\Administrator\.workbuddy\binaries\dotnet")
EXE = r"E:\capture-tool\release\岐黄鉴方采集助手-net\app\QhjfCapture.exe"

os.system("taskkill /IM QhjfCapture.exe /F >nul 2>&1")
time.sleep(1.5)
proc = subprocess.Popen([EXE], cwd=os.path.dirname(EXE), env=ENV)
print("PID", proc.pid)

ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", ctypes.c_long), ("dy", ctypes.c_long), ("mouseData", ctypes.c_ulong),
                ("dwFlags", ctypes.c_ulong), ("time", ctypes.c_ulong), ("dwExtraInfo", ULONG_PTR)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("mi", MOUSEINPUT)]


def send_click(x, y):
    # 先移动
    inp = INPUT(0, MOUSEINPUT(x, y, 0, 0x0001 | 0x8000, 0, 0))
    u32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
    time.sleep(0.15)
    for flag in (0x0002, 0x0004):
        inp = INPUT(0, MOUSEINPUT(x, y, 0, flag, 0, 0))
        u32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
        time.sleep(0.1)
    time.sleep(0.4)


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


small = []
for _ in range(30):
    time.sleep(1)
    w = wins(proc.pid)
    small = [x for x in w if 50 <= x[3] <= 100 and 50 <= x[4] <= 100]
    if small:
        break
print("启动后:", w)
h, l, t, bw, bh = small[0]
print(f"浮球 hwnd={h} {bw}x{bh} @({l},{t})")
print("SetForegroundWindow:", u32.SetForegroundWindow(h), "err", ctypes.get_last_error())
time.sleep(0.5)
fg = u32.GetForegroundWindow()
print("当前前台:", fg, "是否浮球:", fg == h)
send_click(l + bw // 2, t + bh // 2)
for i in range(5):
    time.sleep(0.6)
    print(f"点击后 {i}:", wins(proc.pid))
os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1")
