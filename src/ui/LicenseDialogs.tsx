import { useState } from 'react';
import { AUTHOR, APP_VERSION } from '../branding';
import { DONORS, DONOR_TYPE_LABEL, type DonorType } from '../donors';
import { activateLicense, clearLicense, type LicenseInfo } from '../license';
import { isTauri } from '../io/nativeSave';
import type { Backup } from '../io/designs';
import { t, useLang, setLang } from '../i18n';
import { toast } from './toast';

const SupportLinks = () => (
  <div className="support-links">
    <a href={AUTHOR.paypal} target="_blank" rel="noreferrer">
      💳 Donar (PayPal)
    </a>
    <a href={AUTHOR.github} target="_blank" rel="noreferrer">
      🐙 GitHub
    </a>
    <a href={AUTHOR.linkedin} target="_blank" rel="noreferrer">
      💼 LinkedIn
    </a>
  </div>
);

// ---------- Ajustes ----------

interface SettingsProps {
  onClose: () => void;
  license: LicenseInfo | null;
  setLicense: (l: LicenseInfo | null) => void;
  onRequestLicense: () => void;
  updateMsg: string;
  onCheckUpdate: () => void;
  offlineMsg: string;
  onPrepareOffline: () => void;
  backups: Backup[];
  onRestoreBackup: (b: Backup) => void;
}

export function SettingsDialog({
  onClose,
  license,
  setLicense,
  onRequestLicense,
  updateMsg,
  onCheckUpdate,
  offlineMsg,
  onPrepareOffline,
  backups,
  onRestoreBackup,
}: SettingsProps) {
  const lang = useLang();
  const [licenseInput, setLicenseInput] = useState('');
  const [licenseMsg, setLicenseMsg] = useState('');

  const onActivate = async () => {
    const info = await activateLicense(licenseInput);
    if (info) {
      setLicense(info);
      setLicenseMsg('');
      setLicenseInput('');
      toast(`¡Licencia activada! Gracias, ${info.name} 💛`, 'success');
    } else {
      setLicenseMsg('Clave inválida o caducada.');
    }
  };

  // Muro de donantes: lista incluida + tu propio nombre si tienes licencia.
  const donorWall = (() => {
    const list = DONORS.map((d) => ({ ...d, isYou: false }));
    if (license && !list.some((d) => d.name === license.name)) {
      list.unshift({ name: license.name, type: 'natural', isYou: true });
    } else if (license) {
      const i = list.findIndex((d) => d.name === license.name);
      if (i >= 0) list[i].isYou = true;
    }
    return list;
  })();

  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card" onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>Ajustes y licencia</h3>

        <div className="settings-section">
          <span className="settings-label">{t('Aplicación')}</span>
          <div className="settings-row">
            <span>ChamVa</span>
            <span className="settings-val">
              {t('versión')} {APP_VERSION}
            </span>
          </div>
          <div className="settings-row">
            <span>{t('Autor')}</span>
            <span className="settings-val">{AUTHOR.name}</span>
          </div>
          {isTauri() && (
            <div className="settings-row">
              <button className="link-btn" onClick={onCheckUpdate}>
                🔄 {t('Buscar actualizaciones')}
              </button>
              <span className="settings-val">{updateMsg}</span>
            </div>
          )}
          <div className="settings-row">
            <span>{t('Idioma')}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as 'es' | 'en')}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <div className="settings-section">
          <span className="settings-label">{t('Modelos de IA sin internet')}</span>
          <p className="support-desc">
            Descarga los modelos una vez y quitar fondo / optimizar funcionarán sin conexión
            para siempre. También deja listo el conversor de video.
          </p>
          <button
            className="link-btn"
            onClick={onPrepareOffline}
            disabled={!!offlineMsg && !offlineMsg.startsWith('✓') && !offlineMsg.startsWith('✕')}
          >
            ⬇ {offlineMsg || t('Descargar todos los modelos')}
          </button>
        </div>

        {backups.length > 0 && (
          <div className="settings-section">
            <span className="settings-label">{t('Copias de seguridad')}</span>
            <ul className="backup-list">
              {backups.map((b) => (
                <li key={b.ts}>
                  <span>
                    {new Date(b.ts).toLocaleTimeString()} · {b.pages.length} pág.
                  </span>
                  <button className="link-btn" onClick={() => onRestoreBackup(b)}>
                    ↩ {t('Restaurar')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="settings-section">
          <span className="settings-label">Licencia</span>
          {license ? (
            <>
              <div className="supporter-badge">★ Donante</div>
              <p className="supporter-name">¡Gracias, {license.name}! 💛</p>
              <p className="support-desc">
                Licencia válida hasta {new Date(license.exp * 1000).toLocaleDateString()}.
              </p>
              <button
                className="link-btn dim"
                onClick={() => {
                  clearLicense();
                  setLicense(null);
                }}
              >
                Quitar licencia
              </button>
            </>
          ) : (
            <>
              <p className="support-desc">
                Gratis y sin restricciones. Con una licencia de apoyo desaparecen los avisos de
                donación durante 1 año.
              </p>
              <div className="license-activate">
                <input
                  type="text"
                  placeholder="Pega tu clave de licencia…"
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                />
                <button onClick={onActivate}>Activar</button>
              </div>
              {licenseMsg && <p className="license-msg">{licenseMsg}</p>}
              <button className="link-btn" onClick={onRequestLicense}>
                🔑 Solicitar clave de licencia (1 año)
              </button>
            </>
          )}
        </div>

        {!license && (
          <div className="settings-section">
            <span className="settings-label">Apoya el proyecto</span>
            <SupportLinks />
          </div>
        )}

        <div className="settings-section">
          <span className="settings-label">🏅 Muro de donantes ({donorWall.length})</span>
          {donorWall.length === 0 ? (
            <p className="support-desc">Aún no hay donantes. ¡Sé el primero en apoyar! 💛</p>
          ) : (
            <ul className="donor-wall">
              {donorWall.map((d, i) => (
                <li key={i} className={d.isYou ? 'you' : ''}>
                  <span className="donor-name">
                    {d.name} {d.isYou && <em>(tú)</em>}
                  </span>
                  <span className="donor-type">{DONOR_TYPE_LABEL[d.type]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="author-credit">
          © {new Date().getFullYear()} {AUTHOR.name}
        </p>
      </div>
    </div>
  );
}

// ---------- Aviso de apoyo tras descargar ----------

export function DonateDialog({ onClose, onRequestLicense }: { onClose: () => void; onRequestLicense: () => void }) {
  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="donate-card" onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>¡Tu archivo se descargó! 💛</h3>
        <p>
          ChamVa es gratis y sin marcas de agua. Si te ayuda, apóyame con una donación o consigue
          una licencia de apoyo (1 año).
        </p>
        <SupportLinks />
        <button className="link-btn" onClick={onRequestLicense}>
          🔑 Solicitar clave de licencia (1 año)
        </button>
      </div>
    </div>
  );
}

// ---------- Solicitud de licencia ----------

export function RequestLicenseDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<DonorType>('natural');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  const submit = () => {
    if (!name.trim()) {
      toast('Escribe tu nombre o el de tu institución/empresa.', 'info');
      return;
    }
    const body = [
      `Nombre: ${name}`,
      `Tipo: ${DONOR_TYPE_LABEL[type]}`,
      `Correo: ${email}`,
      `Mensaje: ${msg}`,
      '',
      'Adjunto el comprobante de mi donación por PayPal (paypal.me/bibliotecologo).',
    ].join('\n');
    window.open(AUTHOR.paypal, '_blank');
    window.location.href = `mailto:${AUTHOR.email}?subject=${encodeURIComponent(
      'Solicitud de licencia ChamVa (1 año)',
    )}&body=${encodeURIComponent(body)}`;
    onClose();
    toast('Abrimos PayPal y tu correo para enviar la solicitud.', 'success');
  };

  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card" onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>Solicitar clave de licencia (1 año)</h3>
        <p className="support-desc">
          Dona por PayPal y envíanos tus datos. Te responderemos con tu clave a {AUTHOR.email}.
        </p>

        <label className="req-field">
          Nombre completo / Institución / Empresa
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre o el de tu organización"
          />
        </label>
        <label className="req-field">
          Tipo
          <select value={type} onChange={(e) => setType(e.target.value as DonorType)}>
            <option value="natural">Persona natural</option>
            <option value="institucion">Institución</option>
            <option value="empresa">Empresa</option>
          </select>
        </label>
        <label className="req-field">
          Tu correo
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="para enviarte la clave"
          />
        </label>
        <label className="req-field">
          Mensaje (opcional)
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={2}
            placeholder="¿Quieres aparecer en el muro de donantes? ¿Algún comentario?"
          />
        </label>

        <button className="primary req-send" onClick={submit}>
          💳 Donar y enviar solicitud
        </button>
      </div>
    </div>
  );
}
