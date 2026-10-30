' Game Zone launcher (Windows only)
' Double-click this file: it opens the website and speaks the welcome line.

Dim statement, voice, shell, fso, folder

statement = "Welcome back, sir in this game "

' Open the website first so it loads while the voice speaks
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.Run """" & folder & "\index.html"""

' Speak the welcome message
Set voice = CreateObject("SAPI.SpVoice")
voice.Speak statement
