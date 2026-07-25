import React, { useEffect, useState } from 'react';

/**
 * RamaOrb — Persistent Rāma AI presence indicator.
 * Pulsing rings, glowing core, active state during AI activity.
 */
export default function RamaOrb({ size = 40, active = false, onClick }) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (active) { setPulse(true); }
    else { const t = setTimeout(() => setPulse(false), 600); return () => clearTimeout(t); }
  }, [active]);

  // Logo colors: ice blue outer ring, gold inner accent, white spark
  const coreColor  = active ? '#00c8ff' : '#0088bb';
  const ringColor  = active ? '#00c8ff' : '#005580';
  const outerColor = active ? '#d4a940' : 'rgba(0,200,255,0.2)';

  return (
    <div onClick={onClick} title={active ? 'Rāma is thinking...' : 'Rāma AGI — Online'}
      style={{ position: 'relative', width: `${size}px`, height: `${size}px`,
        cursor: onClick ? 'pointer' : 'default', flexShrink: 0 }}>

      {/* Outer gold pulse ring — logo's radiant glow */}
      <div style={{
        position:     'absolute',
        top:          '50%', left: '50%',
        width:        `${size * 1.5}px`, height: `${size * 1.5}px`,
        transform:    'translate(-50%, -50%)',
        borderRadius: '50%',
        border:       `1px solid ${outerColor}`,
        opacity:      0.3,
        animation:    'pulse-ring 3s ease infinite',
      }} />

      {/* Ice blue ring — logo's primary ring */}
      <div style={{
        position:     'absolute',
        inset:        `${size * 0.05}px`,
        borderRadius: '50%',
        border:       `1px solid ${ringColor}`,
        opacity:      active ? 0.6 : 0.3,
        animation:    'pulse-ring 2.5s ease infinite 0.5s',
      }} />

      {/* Rotating arc — logo's dynamic energy */}
      <div style={{
        position:     'absolute',
        inset:        `${size * 0.1}px`,
        borderRadius: '50%',
        border:       `1.5px solid transparent`,
        borderTopColor:   active ? '#00c8ff' : 'rgba(0,200,255,0.4)',
        borderRightColor: active ? '#d4a940' : 'rgba(212,169,64,0.3)',
        opacity:      0.8,
        animation:    `orb-rotate ${active ? '1.5s' : '4s'} linear infinite`,
      }} />

      {/* Inner orb — logo's neural core */}
      <div style={{
        position:     'absolute',
        inset:        `${size * 0.22}px`,
        borderRadius: '50%',
        background:   active
          ? 'radial-gradient(circle at 35% 35%, #4dd9ff, #00c8ff 50%, #001a33)'
          : 'radial-gradient(circle at 35% 35%, #0088bb, #005580 60%, #001020)',
        boxShadow:    active
          ? '0 0 12px rgba(0,200,255,0.6), 0 0 24px rgba(0,200,255,0.2), inset 0 0 8px rgba(77,217,255,0.3)'
          : '0 0 8px rgba(0,136,187,0.4)',
        transition:   'all 0.3s ease',
      }} />

      {/* Center spark — logo's bright highlight */}
      <div style={{
        position:     'absolute',
        top: '50%', left: '50%',
        transform:    'translate(-50%, -50%)',
        width:        `${size * 0.16}px`, height: `${size * 0.16}px`,
        borderRadius: '50%',
        background:   active ? 'rgba(255,255,255,0.95)' : 'rgba(200,240,255,0.6)',
        boxShadow:    active ? '0 0 8px rgba(255,255,255,0.9), 0 0 16px rgba(0,200,255,0.8)' : 'none',
        transition:   'all 0.3s ease',
      }} />
    </div>
  );
}
