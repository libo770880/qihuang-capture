' QHJF Capture Assistant - minimal launcher (folder-relative, no console window)
Option Explicit
On Error Resume Next
Dim sh, base, electron, appDir
Set sh = CreateObject("WScript.Shell")
base = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
sh.Environment("PROCESS").Remove "ELECTRON_NO_ATTACH_CONSOLE"
electron = """" & base & "runtime\electron.exe"""
appDir = """" & base & "app"""
sh.CurrentDirectory = base & "app"
sh.Run electron & " " & appDir & " --no-sandbox --disable-gpu", 1, False
