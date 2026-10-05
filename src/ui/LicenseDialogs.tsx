import { useState, useRef } from 'react';
import { AUTHOR, APP_VERSION, GOAL, LICENSE_PLANS, SUPPORT } from '../branding';
import { DONORS, DONOR_TYPE_LABEL } from '../donors';
import {
  activateLicense,
  clearLicense,
  isPermanent,
  LICENSE_TYPE_LABEL,
  type LicenseInfo,
  type LicenseType,
} from '../license';
import { isTauri } from '../io/nativeSave';
import type { Backup } from '../io/designs';
import { t, useLang } from '../i18n';
import { LangSetting } from './LangSetting';
import { UiScaleSetting } from './UiScale';
import { ShortcutsEditor } from './ShortcutsEditor';
import { LocalBadge } from './LocalBadge';
import { BackupSection } from './BackupSection';
import { toast } from './toast';
import { getTheme, setTheme, type Theme } from '../theme';
import { externalClick, openExternal } from '../io/openExternal';
import { useDismiss } from './useDismiss';
import { FfmpegLicenseSection } from '../video/native/FfmpegLicenseSection';

const copyNequi = async () => {
  try {
    await navigator.clipboard.writeText(SUPPORT.nequi);
    toast(`Número de Nequi copiado: ${SUPPORT.nequi}`, 'success');
  } catch {
    toast(`Nequi: ${SUPPORT.nequi}`, 'info');
  }
};

const SupportLinks = () => (
  <div className="pay-grid">
    <a className="pay-btn" href={SUPPORT.sponsors} onClick={externalClick}>
      <b>GitHub Sponsors</b>
      <span>Aporte único o mensual</span>
    </a>
    <button type="button" className="pay-btn" onClick={copyNequi} title="Copiar número">
      <b>Nequi</b>
      <span>{SUPPORT.nequi} · copiar</span>
    </button>
    <a className="pay-btn" href={AUTHOR.paypal} onClick={externalClick}>
      <b>PayPal</b>
      <span>{t('Invítame un café')}</span>
    </a>
    <a className="pay-btn" href={AUTHOR.repo} onClick={externalClick}>
      <b>GitHub</b>
      <span>{t('Dale una estrella en GitHub')}</span>
    </a>
  </div>
);

const cop = (n: number) => '$' + n.toLocaleString('es-CO') + ' COP';

const GoalBar = () => (
  <div className="goal-box">
    <span className="goal-title">Meta</span>
    <span className="goal-text">{GOAL.label}</span>
    {GOAL.raised > 0 ? (
      <>
        <div className="goal-track">
          <div style={{ width: `${Math.min(100, (GOAL.raised / GOAL.target) * 100)}%` }} />
        </div>
        <span className="goal-num">
          {cop(GOAL.raised)} de {cop(GOAL.target)}
        </span>
      </>
    ) : (
      <span className="goal-num">{cop(GOAL.target)}</span>
    )}
  </div>
);

const LicensePlans = ({ onRequest }: { onRequest: (plan: LicenseType) => void }) => (
  <div className="plan-list">
    {LICENSE_PLANS.map((p) => (
      <div key={p.type} className={`plan-row${p.type === 'permanente' ? ' featured' : ''}`}>
        <div className="plan-info">
          <span className="plan-title">
            {p.label}
            {p.type === 'permanente' && <i className="plan-tag">Recomendada</i>}
          </span>
          {'note' in p && <span className="plan-note">{p.note}</span>}
        </div>
        <span className="plan-price">{p.price}</span>
        <button onClick={() => onRequest(p.type)}>{p.type === 'educativa' ? 'Solicitar' : 'Comprar'}</button>
      </div>
    ))}
  </div>
);

export const AuthorCard = () => {
  const [photo, setPhoto] = useState(true);
  const initials = AUTHOR.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');
  return (
    <div className="author-card">
      {photo ? (
        // Foto opcional: el autor puede poner la suya en public/autor.jpg.
        <img src={import.meta.env.BASE_URL + 'autor.jpg'} alt={AUTHOR.name} onError={() => setPhoto(false)} />
      ) : (
        <span className="author-avatar">{initials}</span>
      )}
      <div className="author-body">
        <strong>{AUTHOR.name}</strong>
        <p>
          Programador en Medellín. Hago ChamVa solo y gratis para que cualquiera pueda diseñar sin pagar ni
          depender de internet.
        </p>
        <div className="author-links">
          <a href={AUTHOR.github} onClick={externalClick}>
            GitHub
          </a>
          <a href={AUTHOR.linkedin} onClick={externalClick}>
            LinkedIn
          </a>
          <a href={`mailto:${AUTHOR.email}`} onClick={externalClick}>
            {AUTHOR.email}
          </a>
        </div>
      </div>
    </div>
  );
};

// ---------- Ajustes ----------

interface SettingsProps {
  onClose: () => void;
  license: LicenseInfo | null;
  setLicense: (l: LicenseInfo | null) => void;
  onRequestLicense: (plan?: LicenseType) => void;
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
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose: onClose });
  useLang();
  const [showKeys, setShowKeys] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme());
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
      list.unshift({
        name: license.name,
        type: license.type === 'educativa' ? 'institucion' : 'natural',
        isYou: true,
      });
    } else if (license) {
      const i = list.findIndex((d) => d.name === license.name);
      if (i >= 0) list[i].isYou = true;
    }
    return list;
  })();

  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
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
          {isTauri() && (
            <div className="settings-row">
              <button className="link-btn" onClick={onCheckUpdate}>
                🔄 {t('Buscar actualizaciones')}
              </button>
              <span className="settings-val">{updateMsg}</span>
            </div>
          )}
          <div className="settings-row">
            <span>{t('Tema')}</span>
            <select
              value={theme}
              onChange={(e) => {
                setThemeState(e.target.value as Theme);
                setTheme(e.target.value as Theme);
              }}
            >
              <option value="system">{t('Sistema')}</option>
              <option value="light">{t('Claro')}</option>
              <option value="dark">{t('Oscuro')}</option>
              <option value="contrast">{t('Alto contraste')}</option>
            </select>
          </div>
          <UiScaleSetting />
          <LangSetting />
          <div className="settings-row">
            <button className="link-btn" onClick={() => setShowKeys((v) => !v)} aria-expanded={showKeys}>
              ⌨ {t('Atajos')} {showKeys ? '▾' : '▸'}
            </button>
          </div>
          {showKeys && <ShortcutsEditor />}
          <div className="settings-row">
            <LocalBadge full />
          </div>
        </div>

        <div className="settings-section">
          <span className="settings-label">{t('Modelos de IA sin internet')}</span>
          <p className="support-desc">
            Descarga los modelos una vez y quitar fondo / optimizar funcionarán sin conexión
            para siempre. (El video ya no necesita descargas: se exporta con el navegador.)
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

        <BackupSection />

        <div className="settings-section">
          <span className="settings-label">Licencia</span>
          {license ? (
            <>
              <div className="supporter-badge">★ Donante</div>
              <p className="supporter-name">Gracias, {license.name}.</p>
              <p className="support-desc">
                {LICENSE_TYPE_LABEL[license.type]} ·{' '}
                {isPermanent(license)
                  ? 'no caduca'
                  : `válida hasta ${new Date(license.exp * 1000).toLocaleDateString()}`}
                .
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
                ChamVa funciona completo sin licencia. Con una licencia desaparecen los avisos de
                apoyo y entras al muro de donantes.
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
              <LicensePlans onRequest={onRequestLicense} />
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
          <span className="settings-label">Muro de donantes ({donorWall.length})</span>
          {donorWall.length === 0 ? (
            <p className="support-desc">Aún no hay donantes. Sé el primero en apoyar.</p>
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

        <FfmpegLicenseSection />

        <div className="settings-section">
          <span className="settings-label">{t('Sobre el autor')}</span>
          <AuthorCard />
        </div>

        <p className="author-credit">
          © {new Date().getFullYear()} {AUTHOR.name}
        </p>
      </div>
    </div>
  );
}

// ---------- Aviso de apoyo (estilo WinRAR: la app sigue completa) ----------

export function DonateDialog({
  onClose,
  onRequestLicense,
  title = 'Gracias por usar ChamVa',
}: {
  onClose: () => void;
  onRequestLicense: (plan: LicenseType) => void;
  title?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose: onClose });
  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="donate-card wide" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>{title}</h3>
        <p>
          ChamVa es gratis, sin marcas de agua y funciona completo. Si lo usas seguido, invítame un
          café o compra una licencia: este aviso no vuelve a salir.
        </p>
        <GoalBar />
        <SupportLinks />
        <LicensePlans onRequest={onRequestLicense} />
        <button className="link-btn dim" onClick={onClose}>
          Seguir sin licencia
        </button>
      </div>
    </div>
  );
}

// ---------- Solicitud de licencia ----------

export function RequestLicenseDialog({
  onClose,
  initialPlan = 'permanente',
}: {
  onClose: () => void;
  initialPlan?: LicenseType;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDismiss(cardRef, { onClose: onClose });
  const [plan, setPlan] = useState<LicenseType>(initialPlan);
  const [free, setFree] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const planInfo = LICENSE_PLANS.find((p) => p.type === plan)!;
  const isFree = plan === 'educativa' && free;

  const submit = () => {
    if (!name.trim()) {
      toast(plan === 'educativa' ? 'Escribe el nombre de la institución.' : 'Escribe tu nombre.', 'info');
      return;
    }
    const subject = isFree
      ? `Solicitud formal de licencia educativa gratuita de ChamVa — ${name}`
      : `Solicitud de licencia ChamVa: ${planInfo.label}`;
    const body = (
      isFree
        ? [
            `Señor ${AUTHOR.name}:`,
            '',
            `La institución ${name} solicita formalmente una licencia educativa permanente de ChamVa.`,
            '',
            `Uso educativo previsto: ${msg || '(describir: cursos, número de estudiantes, docentes…)'}`,
            '',
            `Correo de contacto: ${email}`,
            '',
            'Adjuntamos un documento que acredita a la institución (carta en papel membrete o similar).',
          ]
        : [
            `Licencia: ${planInfo.label} (${planInfo.price})`,
            `Nombre${plan === 'educativa' ? ' de la institución' : ''}: ${name}`,
            `Correo: ${email}`,
            `Mensaje: ${msg}`,
            '',
            `Pagué por: [Nequi ${SUPPORT.nequi} / PayPal / GitHub Sponsors] — adjunto el comprobante.`,
          ]
    ).join('\n');
    openExternal(
      `mailto:${AUTHOR.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    );
    onClose();
    toast('Abrimos tu correo con la solicitud lista para enviar.', 'success');
  };

  return (
    <div className="donate-overlay" onClick={onClose}>
      <div className="settings-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <button className="donate-close" onClick={onClose}>
          ✕
        </button>
        <h3>Solicitar licencia</h3>

        <label className="req-field">
          Licencia
          <select value={plan} onChange={(e) => setPlan(e.target.value as LicenseType)}>
            {LICENSE_PLANS.map((p) => (
              <option key={p.type} value={p.type}>
                {p.label} — {p.price}
              </option>
            ))}
          </select>
        </label>

        {plan === 'educativa' && (
          <label className="req-check">
            <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
            Solicitar gratis: somos un colegio o institución educativa y lo justificamos formalmente.
          </label>
        )}

        {!isFree && (
          <div className="pay-steps">
            <p className="support-desc">
              1. Paga <b>{planInfo.price}</b> por cualquiera de estos medios:
            </p>
            <SupportLinks />
            <p className="support-desc">
              2. Envía la solicitud con el comprobante. Te respondemos con tu clave a tu correo.
            </p>
          </div>
        )}

        <label className="req-field">
          {plan === 'educativa' ? 'Nombre de la institución' : 'Nombre completo'}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
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
          {isFree ? 'Uso educativo (cursos, estudiantes, docentes…)' : 'Mensaje (opcional)'}
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={isFree ? 3 : 2}
            placeholder={isFree ? '' : '¿Quieres aparecer en el muro de donantes?'}
          />
        </label>

        <button className="primary req-send" onClick={submit}>
          {isFree ? 'Preparar carta formal por correo' : 'Enviar solicitud por correo'}
        </button>
      </div>
    </div>
  );
}
