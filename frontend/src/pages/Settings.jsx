import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Bell, Info, Keyboard, Laptop, Moon, Palette, RotateCcw, Sun, Sliders } from 'lucide-react';
import { ACCENTS, useSettings } from '../settings.jsx';
import { useToast } from '../toast.jsx';
import { useDocumentTitle } from '../hooks.js';
import { AppIcon } from '../components/brand.jsx';
import { SHORTCUTS } from '../components/Shell.jsx';

function Switch({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

function Section({ id, icon: Icon, title, sub, children }) {
  return (
    <motion.section id={id} className="card" aria-labelledby={`${id}-h`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ scrollMarginTop: 90 }}>
      <div className="card-title" style={{ marginBottom: 4 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="kpi-icon"><Icon aria-hidden="true" /></span>
          <div><h2 id={`${id}-h`} style={{ margin: 0 }}>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
        </div>
      </div>
      {children}
    </motion.section>
  );
}

function Row({ title, sub, children }) {
  return <div className="set-row"><div className="txt"><b>{title}</b>{sub && <span>{sub}</span>}</div><div className="row">{children}</div></div>;
}

const MODES = [
  { id: 'light', label: 'Light', icon: Sun, bg: '#f6f4ee', side: '#0f2e2a', card: '#ffffff' },
  { id: 'dark', label: 'Dark', icon: Moon, bg: '#0b1210', side: '#0f2e2a', card: '#17231f' },
  { id: 'system', label: 'Match system', icon: Laptop, bg: 'linear-gradient(90deg,#f6f4ee 50%,#0b1210 50%)', side: '#0f2e2a', card: 'linear-gradient(90deg,#fff 50%,#17231f 50%)' },
];

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const { settings, set, reset } = useSettings();
  const { toast } = useToast();
  const [health, setHealth] = useState(null);
  useEffect(() => { fetch('/healthz').then((r) => r.json()).then(setHealth).catch(() => setHealth({ status: 'down' })); }, []);

  const update = (patch, msg) => { set(patch); if (msg) toast(msg, { kind: 'info', duration: 2200 }); };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Preferences</div>
          <h1>Settings</h1>
          <p className="page-sub">Make ExpenseFlow yours. Preferences are saved on this device.</p>
        </div>
        <button type="button" className="btn" onClick={() => { reset(); toast('Preferences reset to default', { kind: 'info' }); }}><RotateCcw aria-hidden="true" /> Reset all</button>
      </div>

      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {[['appearance', Palette, 'Appearance'], ['workspace', Sliders, 'Workspace'], ['notifications', Bell, 'Notifications'], ['keyboard', Keyboard, 'Keyboard'], ['about', Info, 'About']].map(([id, Icon, l]) => (
            <a key={id} href={`#${id}`}><Icon aria-hidden="true" />{l}</a>
          ))}
        </nav>

        <div>
          <Section id="appearance" icon={Palette} title="Appearance" sub="Theme, colour and density">
            <div className="set-row" style={{ display: 'block' }}>
              <div className="txt" style={{ marginBottom: 12 }}><b>Mode</b><span>Light, dark, or follow your operating system.</span></div>
              <div className="theme-cards" role="radiogroup" aria-label="Colour mode">
                {MODES.map((m) => (
                  <button key={m.id} type="button" className="theme-card" role="radio" aria-checked={settings.mode === m.id} aria-pressed={settings.mode === m.id}
                    onClick={() => update({ mode: m.id })}>
                    <div className="mini" style={{ background: m.bg }}>
                      <i style={{ background: m.side }} />
                      <i style={{ padding: 10, display: 'grid', gap: 6, alignContent: 'start' }}>
                        <i style={{ display: 'block', height: 8, width: '60%', borderRadius: 4, background: m.card, boxShadow: '0 1px 2px rgba(0,0,0,.15)' }} />
                        <i style={{ display: 'block', height: 26, borderRadius: 6, background: m.card, boxShadow: '0 1px 2px rgba(0,0,0,.15)' }} />
                        <i style={{ display: 'block', height: 8, width: '35%', borderRadius: 4, background: '#e89b2d' }} />
                      </i>
                    </div>
                    <span className="row" style={{ gap: 6 }}><m.icon size={14} aria-hidden="true" />{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <Row title="Brand theme" sub={ACCENTS.find((a) => a.id === settings.accent)?.name}>
              <div className="swatches" role="radiogroup" aria-label="Brand theme">
                {ACCENTS.map((a) => (
                  <button key={a.id} type="button" className="swatch" role="radio" aria-checked={settings.accent === a.id} aria-pressed={settings.accent === a.id}
                    aria-label={a.name} title={a.name} onClick={() => update({ accent: a.id }, `Theme: ${a.name}`)}
                    style={{ background: `linear-gradient(140deg, ${a.brand2}, ${a.brand})`, '--sw-accent': a.accent }} />
                ))}
              </div>
            </Row>
            <Row title="Density" sub="Compact fits more rows in tables and queues.">
              <div className="segmented" role="group" aria-label="Density">
                {['comfortable', 'compact'].map((d) => (
                  <button key={d} type="button" aria-pressed={settings.density === d} onClick={() => update({ density: d })}>
                    {settings.density === d && <motion.span layoutId="dens-pill" className="seg-pill" />}{d === 'comfortable' ? 'Comfortable' : 'Compact'}
                  </button>
                ))}
              </div>
            </Row>
            <Row title="Reduce motion" sub="Turns off animations. We also follow your OS setting automatically.">
              <Switch label="Reduce motion" checked={settings.motion === 'reduced'} onChange={(v) => update({ motion: v ? 'reduced' : 'system' })} />
            </Row>
            <Row title="Collapsed sidebar" sub="Icons only. Shortcut: [">
              <Switch label="Collapsed sidebar" checked={settings.collapsed} onChange={(v) => update({ collapsed: v })} />
            </Row>
          </Section>

          <Section id="workspace" icon={Sliders} title="Workspace" sub="How ExpenseFlow behaves for you">
            <Row title="Start page" sub="Where you land after signing in.">
              <select className="input" style={{ width: 200 }} value={settings.startPage} onChange={(e) => update({ startPage: e.target.value }, 'Start page saved')} aria-label="Start page">
                <option value="auto">Based on my role</option>
                <option value="/claims">My claims</option>
                <option value="/approvals">Approvals</option>
                <option value="/dashboard">Dashboard</option>
              </select>
            </Row>
            <Row title="Currency & numbers" sub="Indian Rupee with lakh / crore grouping (₹1,00,000).">
              <span className="chip chip-brand chip-plain">₹ en-IN</span>
            </Row>
            <Row title="Time zone" sub="All times are shown in India Standard Time.">
              <span className="chip chip-brand chip-plain">IST · UTC+5:30</span>
            </Row>
          </Section>

          <Section id="notifications" icon={Bell} title="Notifications" sub="What appears in your notification panel">
            <Row title="Claims waiting for my approval" sub="New items in your approvals inbox.">
              <Switch label="Approvals" checked={settings.notifyApprovals} onChange={(v) => update({ notifyApprovals: v })} />
            </Row>
            <Row title="Claims sent back to me" sub="When an approver asks you to clarify.">
              <Switch label="Sent back" checked={settings.notifySentBack} onChange={(v) => update({ notifySentBack: v })} />
            </Row>
            <Row title="Payouts" sub="When a claim of yours is paid.">
              <Switch label="Payouts" checked={settings.notifyPayouts} onChange={(v) => update({ notifyPayouts: v })} />
            </Row>
            <Row title="Summary" sub="How often to bundle updates.">
              <div className="segmented" role="group" aria-label="Summary frequency">
                {['realtime', 'daily', 'weekly'].map((d) => (
                  <button key={d} type="button" aria-pressed={settings.digest === d} onClick={() => update({ digest: d })}>
                    {settings.digest === d && <motion.span layoutId="dig-pill" className="seg-pill" />}{d[0].toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          <Section id="keyboard" icon={Keyboard} title="Keyboard shortcuts" sub="Press ? anywhere to see these">
            <div className="shortcuts" style={{ marginTop: 8 }}>
              {SHORTCUTS.map(([label, keys]) => (
                <div key={label}><span className="small">{label}</span><span className="row" style={{ gap: 4 }}>{keys.map((k) => <span key={k} className="kbd">{k}</span>)}</span></div>
              ))}
            </div>
          </Section>

          <Section id="about" icon={Info} title="About" sub="Version and system status">
            <div className="row" style={{ gap: 20, padding: '12px 0' }}>
              <AppIcon size={88} />
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Expense<em style={{ color: 'var(--accent)', fontWeight: 500 }}>Flow</em></div>
                <div className="small muted">Version 2.0 “Ledger” · AI Manthan 2026 · Team 01</div>
                <div className="row small" style={{ marginTop: 8 }}>
                  <span className={`dot ${health && health.status !== 'ok' ? 'down' : ''}`} />
                  {health ? (health.status === 'ok' ? 'API and database healthy' : `Status: ${health.status}`) : 'Checking…'}
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
