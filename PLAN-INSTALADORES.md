# ChamVa — Plan: ejecutar la app y generar instaladores (Windows / Linux / macOS)

## La realidad técnica primero

Tauri **no cross-compila**: cada instalador se construye en su propio sistema operativo.

| Instalador | ¿Se puede desde tu PC (Windows)? | Vía |
|---|---|---|
| Windows (`.exe` NSIS, `.msi`) | ✅ Sí, local | `pnpm tauri build` |
| Linux (`.AppImage`, `.deb`, `.rpm`) | ⚠️ Solo vía WSL2 o CI | GitHub Actions (recomendado) |
| macOS (`.dmg`) | ❌ Requiere hardware/runner de Apple | GitHub Actions (única opción sin Mac) |

**Solución central:** el workflow [.github/workflows/release.yml](.github/workflows/release.yml)
(ya creado) compila los **tres a la vez** en runners de GitHub — gratis en repos públicos —
y publica un GitHub Release borrador con todos los instaladores adjuntos.

---

## Paso 0 — Ejecutar la app (desarrollo)

```bash
pnpm install       # una vez, o tras cambiar dependencias
```

```bash
pnpm dev           # solo frontend, en el navegador (http://localhost:1420)
```

```bash
pnpm tauri dev     # app de escritorio real con recarga en caliente (requiere Rust)
```

## Paso 1 — Instalador de Windows (local, hoy mismo)

```bash
pnpm tauri build
```

Resultado en `src-tauri/target/release/bundle/`:
- `nsis/ChamVa_0.1.0_x64-setup.exe` — el instalador que se comparte
- `msi/ChamVa_0.1.0_x64_en-US.msi`

Probarlo instalándolo en limpio. SmartScreen mostrará "editor desconocido" (sin
certificado de firma): **Más información → Ejecutar de todas formas**.

## Paso 2 — Los tres instaladores con GitHub Actions

1. **Subir el workflow** (ya está en el repo):

   ```bash
   git add .github/workflows/release.yml PLAN-INSTALADORES.md
   git commit -m "CI: release multi-plataforma (Windows/Linux/macOS) con tauri-action"
   git push
   ```

2. **Lanzar un release** creando un tag de versión:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

   (También se puede lanzar a mano: GitHub → Actions → Release → *Run workflow*.)

3. **Esperar ~20–35 min** (el runner de macOS compila dos arquitecturas). En
   GitHub → Releases aparecerá un **borrador "ChamVa v0.1.0"** con:
   - `ChamVa_0.1.0_x64-setup.exe` y `.msi` (Windows)
   - `ChamVa_0.1.0_amd64.AppImage`, `.deb` y `.rpm` (Linux)
   - `ChamVa_0.1.0_universal.dmg` (macOS Intel + Apple Silicon)

4. **Revisar y publicar** el borrador. Listo: enlace de descarga para cada SO.

### Para versiones siguientes

Subir la versión en **los tres sitios** (hasta automatizarlo — ver PLAN-MEJORA.md #5):
`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (y `src/branding.ts`).
Luego commit + tag `v0.2.0` + push del tag. Cada tag = un release con los 3 instaladores.

## Paso 3 (opcional) — Instalador de Linux local con WSL2

Solo si quieres compilar Linux sin pasar por GitHub:

```bash
wsl --install -d Ubuntu-22.04
```

Dentro de WSL:

```bash
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl -fsSL https://get.pnpm.io/install.sh | sh -
# clonar el repo DENTRO del sistema de archivos de WSL (~, no /mnt/f — 10x más rápido)
git clone https://github.com/quijotevitruvio/ChamVa.git && cd ChamVa
pnpm install && pnpm tauri build
```

Resultado en `src-tauri/target/release/bundle/` (`appimage/`, `deb/`, `rpm/`).

---

## Avisos por plataforma (apps sin firmar)

- **Windows:** SmartScreen avisa. Se quita con un certificado de firma de código
  (Azure Trusted Signing ≈ US$10/mes) o publicando en winget. No urgente.
- **macOS:** Gatekeeper bloqueará la app ("dañada" o "desarrollador no identificado").
  El usuario debe ejecutar `xattr -cr /Applications/ChamVa.app` o abrir con
  clic derecho → Abrir. Quitarlo de verdad requiere Apple Developer Program
  (US$99/año: firma + notarización). El texto del release ya lo explica.
- **Linux:** sin fricción; el `.AppImage` solo necesita `chmod +x`.

## Problemas típicos

- **Falla el job de macOS** por el target universal → probar cambiando en el
  workflow `args: '--target universal-apple-darwin'` por `args: ''` (compila solo
  Apple Silicon, suficiente para empezar).
- **Falla `pnpm install --frozen-lockfile`** → el lockfile quedó desactualizado:
  correr `pnpm install` local, commitear `pnpm-lock.yaml` y re-taggear.
- **El release no aparece** → es un **borrador**: Releases → Draft, hay que publicarlo.
- **Runner de Linux falla por dependencias** → el workflow ya instala
  `libwebkit2gtk-4.1-dev` y compañía; si Tauri sube de versión mayor, revisar la
  lista en la doc oficial de prerequisitos de Tauri para Linux.
