import { useRef, useState } from 'react';
import { exportLangJson, getLang, importLangPack, listLangs, removeLangPack, setLang, t, useLang } from '../i18n';
import { toast } from './toast';
import './a11y.css';

// Ajustes → Idioma: lista (incluye los importados) + exportar/importar JSON.
export function LangSetting() {
  const lang = useLang();
  const file = useRef<HTMLInputElement>(null);
  const [, bump] = useState(0);
  const langs = listLangs();

  const onExport = () => {
    const l = getLang();
    const blob = new Blob([exportLangJson(l)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chamva-idioma-${l}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const onImport = async (f?: File) => {
    if (!f) return;
    const r = importLangPack(await f.text());
    if (r.ok) toast(`${t('Idioma importado')}: ${r.name}`, 'success');
    else toast(r.error, 'error');
    bump((n) => n + 1);
  };

  return (
    <>
      <div className="settings-row">
        <span>{t('Idioma')}</span>
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {langs.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row lang-actions">
        <button className="link-btn" onClick={onExport}>
          ⬇ {t('Exportar idioma actual (JSON)')}
        </button>
        <button className="link-btn" onClick={() => file.current?.click()}>
          ⬆ {t('Importar idioma')}
        </button>
        {langs.find((l) => l.code === lang)?.custom && (
          <button
            className="link-btn dim"
            onClick={() => {
              removeLangPack(lang);
              bump((n) => n + 1);
            }}
          >
            {t('Quitar este idioma')}
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            onImport(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </>
  );
}
