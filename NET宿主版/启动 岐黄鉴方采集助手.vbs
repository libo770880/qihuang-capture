Option Explicit
Dim fso, sh, base, exePath
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = base & "\app\QhjfCapture.exe"
sh.CurrentDirectory = base & "\app"
sh.Run Chr(34) & exePath & Chr(34), 0, False
