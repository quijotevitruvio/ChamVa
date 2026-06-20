// API EyeDropper (cuentagotas), soportada por Chromium / WebView2.
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropper {
  open(): Promise<EyeDropperResult>;
}
interface Window {
  EyeDropper?: { new (): EyeDropper };
}
