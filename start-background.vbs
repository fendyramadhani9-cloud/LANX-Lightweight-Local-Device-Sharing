Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

exePath = scriptDir & "\lanx.exe"

' Jika lanx.exe belum ada, compile otomatis
If Not fso.FileExists(exePath) Then
    WshShell.Run "cmd /c go build -o lanx.exe ./cmd/lanx", 0, True
End If

If fso.FileExists(exePath) Then
    ' Jalankan lanx.exe tanpa jendela terminal (WindowStyle = 0)
    WshShell.Run """" & exePath & """", 0, False
    WshShell.Popup "LANX sudah berjalan di latar belakang (Background)!" & vbCrLf & "Akses web di browser: http://localhost:8080", 3, "LANX Aktif", 64
Else
    MsgBox "Gagal menemukan atau meng-compile lanx.exe. Pastikan Golang sudah terpasang.", 16, "LANX Error"
End If
