import { useId, useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';

/**
 * ExpenseFlow 3D app icon: a glossy ink-green tile with an extruded ivory ₹
 * whose lower stroke sweeps into a saffron tick. `tilt` adds a pointer-driven 3D tilt.
 */
export function AppIcon({ size = 40, tilt = false, glow = false, title = 'ExpenseFlow' }) {
  const uid = useId().replace(/:/g, '');
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const still = reduce || (typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced'));
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [14, -14]), { stiffness: 200, damping: 18 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-16, 16]), { stiffness: 200, damping: 18 });
  const shine = useTransform(mx, [-0.5, 0.5], ['20%', '80%']);
  const shineBg = useTransform(shine, (s) => `linear-gradient(115deg, transparent 0%, rgba(255,255,255,0) calc(${s} - 18%), rgba(255,255,255,.55) ${s}, rgba(255,255,255,0) calc(${s} + 18%), transparent 100%)`);

  const onMove = (e) => {
    if (!tilt || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => { mx.set(0); my.set(0); };
  const g = (n) => `${n}-${uid}`;

  const svg = (
    <svg viewBox="0 0 512 512" width={size} height={size} role="img" aria-label={title} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={g('body')} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#2A7466" /><stop offset="0.55" stopColor="#134238" /><stop offset="1" stopColor="#0A2420" />
        </linearGradient>
        <linearGradient id={g('rim')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9FE3CF" stopOpacity=".75" /><stop offset=".45" stopColor="#9FE3CF" stopOpacity=".08" /><stop offset="1" stopColor="#000" stopOpacity=".35" />
        </linearGradient>
        <radialGradient id={g('glow')} cx=".3" cy=".18" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".32" /><stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g('ivory')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#E6EFEA" /></linearGradient>
        <linearGradient id={g('saf')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFC768" /><stop offset="1" stopColor="#E0861F" /></linearGradient>
        <filter id={g('drop')} x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#03110E" floodOpacity=".45" /></filter>
        {glow && <filter id={g('outer')} x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="28" stdDeviation="26" floodColor="#000" floodOpacity=".45" /></filter>}
      </defs>
      <g filter={glow ? `url(#${g('outer')})` : undefined}>
        <rect x="24" y="24" width="464" height="464" rx="112" fill={`url(#${g('body')})`} />
        <rect x="24" y="24" width="464" height="464" rx="112" fill={`url(#${g('glow')})`} />
        <rect x="28" y="28" width="456" height="456" rx="108" fill="none" stroke={`url(#${g('rim')})`} strokeWidth="8" />
      </g>
      <g transform="translate(-14 -8)">
        <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="40" transform="translate(0 14)" stroke="#061A16" opacity=".55">
          <path d="M150 140 H340 M150 206 H340 M196 140 C300 140 300 272 196 272 H168 L262 386 L384 214" />
        </g>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="40" filter={`url(#${g('drop')})`}>
          <path d="M150 140 H340 M150 206 H340 M196 140 C300 140 300 272 196 272 H168 L262 386" stroke={`url(#${g('ivory')})`} />
          <path d="M262 386 L384 214" stroke={`url(#${g('saf')})`} />
        </g>
        <path d="M282 352 L370 228" stroke="#FFF3D6" strokeOpacity=".7" strokeWidth="8" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );

  if (!tilt) return svg;
  return (
    <motion.div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave}
      style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d', position: 'relative', width: size, height: size }}
      initial={{ opacity: 0, scale: 0.8, rotateX: 30 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>
      <motion.div animate={still ? { y: 0 } : { y: [0, -8, 0] }} transition={still ? { duration: 0 } : { duration: 6, repeat: Infinity, ease: 'easeInOut' }} style={{ transform: 'translateZ(40px)' }}>
        {svg}
      </motion.div>
      <motion.div aria-hidden="true" style={{
        position: 'absolute', inset: '5%', borderRadius: '22%', pointerEvents: 'none', mixBlendMode: 'overlay',
        background: shineBg,
      }} />
    </motion.div>
  );
}

export function Wordmark() {
  return <span className="wordmark">Expense<em>Flow</em></span>;
}

function hueFor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
export function initials(name = '') {
  const p = String(name).trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}
export function Avatar({ name, size, className = '' }) {
  return (
    <span className={`avatar ${className}`} style={{ '--h': hueFor(name), ...(size ? { '--size': `${size}px` } : {}) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
