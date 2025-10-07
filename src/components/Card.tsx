import type { ReactNode } from 'react';

export default function Card({ children, className = '', variant }: { children: ReactNode; className?: string; variant?: 'glass' | 'solid' }) {
  return (
    <div
      className={`card ${className}`}
      style={variant === 'glass' ? {
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(8px)'
      } : undefined}
    >
      {children}
    </div>
  )
}
