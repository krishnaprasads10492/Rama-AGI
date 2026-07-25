import React, { useEffect, useState } from 'react';

/**
 * RamaOrb — Persistent Rāma AI presence indicator.
 * Pulsing rings, glowing core, active state during AI activity.
 */
export default function RamaOrb({ size = 40, active = false, onClick }) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (active) {
      setPulse(true);
    } else {
      const t = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(t);
    }
  }, [active]);

  return (
    <div
      onClick={onClick}
      title={active ? 'Rāma is thinking...' : 'Rāma AGI — Online'}
      style={{
        position:   'relative',
        width:      `${size}px`,
        height:     `${size}px`,
        cursor:     onClick ? 'pointer' : 'default',
        flexShrink: 0,
      }}
    >
      {/* Outer ring 1 */}
      <Ring size={size} color="var(--violet)" delay="0s"     opacity={0.25} scale={1.4} />
      {/* Outer ring 2 */}
      <Ring size={size} color="var(--accent)" delay="0.8s"   opacity={0.15} scale={1.7} />
      {/* Rotating arc ring */}
      <div style={{
        position:     'absolute',
        inset:        `${size * 0.08}px`,
        borderRadius: '50%',
        border:       `1px solid var(--violet)`,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        opacity:      0.6,
        animation:    'orb-rotate 3s linear infinite',
      }} />
      {/* Inner core */}
      <div style={{
        position:     'absolute',
        inset:        `${size * 0.2}px`,
        borderRadius: '50%',
        background:   pulse
          ? 'radial-gradient(circle at 35% 35%, #aa44ff, var(--violet) 60%, #110022)'
          : 'radial-gradient(circle at 35% 35%, #8833ee, #5500cc 60%, #0d001a)',
        boxShadow:    pulse
          ? 'var(--glow-violet), inset 0 0 10px rgba(170,68,255,0.5)'
          : '0 0 12px rgba(119,0,255,0.4)',
        transition:   'all 0.3s ease',
      }} />
      {/* Center spark */}
      <div style={{
        position:     'absolute',
        top:          '50%',
        left:         '50%',
        transform:    'translate(-50%,-50%)',
        width:        `${size * 0.18}px`,
        height:       `${size * 0.18}px`,
        borderRadius: '50%',
        background:   'rgba(200,150,255,0.8)',
        boxShadow:    '0 0 6px rgba(200,150,255,0.9)',
      }} />
    </div>
  );
}

function Ring({ size, color, delay, opacity, scale }) {
  return (
    <div style={{
      position:     'absolute',
      top:          '50%',
      left:         '50%',
      width:        `${size}px`,
      height:       `${size}px`,
      borderRadius: '50%',
      border:       `1px solid ${color}`,
      opacity,
      transform:    'translate(-50%,-50%) scale(1)',
      animation:    `pulse-ring 2.5s ease infinite ${delay}`,
      '--scale-end': scale,
    }} />
  );
}
