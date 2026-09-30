# Manifiesto winget de ChamVa

Manifiesto multi-archivo (esquema 1.6.0) de `quijotevitruvio.ChamVa` versión **0.4.0**, instalador NSIS x64
(`ChamVa_0.4.0_x64-setup.exe`). El `InstallerSha256` se calculó descargando el archivo de la release v0.4.0.

> Nada de esto se ha enviado. Lo envía el autor cuando quiera.

## Validar en local (Windows)

```powershell
winget validate --manifest .\packaging\winget
winget settings --enable LocalManifestFiles
winget install --manifest .\packaging\winget   # prueba real de instalación
```

## Enviar a microsoft/winget-pkgs

**Opción A, PR manual.** Haz fork de https://github.com/microsoft/winget-pkgs y copia los 3 archivos `.yaml` a
`manifests/q/quijotevitruvio/ChamVa/0.4.0/`. Abre el PR; un bot valida y un moderador lo aprueba.

**Opción B, wingetcreate.**

```powershell
winget install Microsoft.WingetCreate
wingetcreate submit .\packaging\winget    # pide un token de GitHub y abre el PR por ti
```

## Nuevas versiones

```powershell
wingetcreate update quijotevitruvio.ChamVa --version X.Y.Z --urls https://github.com/quijotevitruvio/ChamVa/releases/download/vX.Y.Z/ChamVa_X.Y.Z_x64-setup.exe --submit
```

Notas: el instalador no está firmado y SmartScreen/antivirus pueden retrasar la revisión. Si `Scope: user` falla en la
prueba de instalación (el NSIS de Tauri puede instalar por máquina), quítalo del `.installer.yaml`.
