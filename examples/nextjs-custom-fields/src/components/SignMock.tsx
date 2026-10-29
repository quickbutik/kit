import type { Material } from "@/lib/signs"
import { useId } from "react"

/**
 * An illustrated sign for catalog cards: the products carry no photos, and a
 * drawing in the right material and proportions says more than a placeholder.
 */
export function SignMock({
  material,
  ratio,
  label,
  sub,
}: {
  material: Material
  ratio: number
  label: string
  sub?: string
}) {
  const id = useId()
  const W = 300
  const H = material.shape === "circle" ? 300 : Math.round(Math.min(300, Math.max(70, W / ratio)))
  const pad = 14
  const r = material.shape === "circle" ? 0 : Math.max(3, material.radiusMm * 1.2)
  const fill =
    material.key === "wood"
      ? `url(#${id}-wood)`
      : material.key === "acrylic"
        ? `url(#${id}-glass)`
        : material.key === "banner"
          ? "#fff9ec"
          : `url(#${id}-metal)`
  const ink = material.key === "banner" ? "#16161a" : material.key === "wood" ? "#2b1a0e" : "#16161a"
  const fontSize = Math.min(48, (H - pad * 2) * 0.32, (W - pad * 2) / Math.max(4, label.length * 0.62))

  return (
    <svg viewBox={`0 0 ${W + pad * 2} ${H + pad * 2 + 10}`} className="sign-mock" role="img" aria-label={label}>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f6f8" />
          <stop offset="0.55" stopColor="#dde2e7" />
          <stop offset="1" stopColor="#c9cfd5" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#e3f4f8" stopOpacity="0.8" />
          <stop offset="1" stopColor="#c8e8f0" stopOpacity="0.9" />
        </linearGradient>
        <pattern id={`${id}-wood`} width="300" height="40" patternUnits="userSpaceOnUse">
          <rect width="300" height="40" fill="#e2bf96" />
          <path d="M0 8 C 80 4, 160 14, 300 7" stroke="#c99c6c" strokeWidth="1.4" fill="none" opacity=".7" />
          <path d="M0 22 C 100 26, 190 16, 300 23" stroke="#b9895a" strokeWidth="1" fill="none" opacity=".6" />
          <path d="M0 33 C 70 30, 200 38, 300 32" stroke="#cfa476" strokeWidth="1.6" fill="none" opacity=".5" />
        </pattern>
        <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#1d1530" floodOpacity="0.18" />
        </filter>
      </defs>

      <g filter={`url(#${id}-shadow)`}>
        {material.shape === "circle" ? (
          <circle cx={pad + W / 2} cy={pad + H / 2} r={W / 2} fill={fill} />
        ) : (
          <rect x={pad} y={pad} width={W} height={H} rx={r} fill={fill} />
        )}
      </g>

      {material.key === "acrylic" && (
        <path
          d={`M${pad + W * 0.08} ${pad} L${pad + W * 0.38} ${pad} L${pad + W * 0.12} ${pad + H} L${pad - 0.01} ${pad + H} Z`}
          fill="#fff"
          opacity="0.35"
        />
      )}

      <text
        x={pad + W / 2}
        y={pad + H / 2 + (sub ? -fontSize * 0.12 : fontSize * 0.34)}
        textAnchor="middle"
        fill={ink}
        style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize, letterSpacing: "-0.02em" }}
      >
        {label}
      </text>
      {sub && (
        <text
          x={pad + W / 2}
          y={pad + H / 2 + fontSize * 0.78}
          textAnchor="middle"
          fill={ink}
          opacity="0.7"
          style={{ fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: Math.max(9, fontSize * 0.3), letterSpacing: "0.12em" }}
        >
          {sub}
        </text>
      )}

      {material.mounting === "holes" &&
        (material.shape === "circle"
          ? [pad + 18, pad + H - 18].map((y) => <circle key={y} cx={pad + W / 2} cy={y} r="3" fill="#3a3f45" opacity=".55" />)
          : [
              [pad + 12, pad + 12],
              [pad + W - 12, pad + 12],
              [pad + 12, pad + H - 12],
              [pad + W - 12, pad + H - 12],
            ].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#3a3f45" opacity=".55" />))}
      {material.mounting === "standoffs" &&
        [
          [pad + 18, pad + 18],
          [pad + W - 18, pad + 18],
          [pad + 18, pad + H - 18],
          [pad + W - 18, pad + H - 18],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="7" fill="#c3c8ce" stroke="#8e949b" strokeWidth="1" />
        ))}
      {material.mounting === "eyelets" &&
        [0, 0.5, 1].flatMap((t) =>
          [pad + 10, pad + H - 10].map((y) => (
            <circle
              key={`${t}-${y}`}
              cx={pad + 10 + (W - 20) * t}
              cy={y}
              r="4"
              fill="none"
              stroke="#9aa0a6"
              strokeWidth="2"
            />
          )),
        )}
    </svg>
  )
}
