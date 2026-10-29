import type { CSSProperties } from "react"

/**
 * A shimmering placeholder block. Give it the size of what replaces it, so
 * nothing moves when the real content arrives.
 */
export function Skeleton({
  width,
  height = "1em",
  className,
  style,
}: {
  width?: CSSProperties["width"]
  height?: CSSProperties["height"]
  className?: string
  style?: CSSProperties
}) {
  return <span aria-hidden className={`skeleton${className ? ` ${className}` : ""}`} style={{ width, height, ...style }} />
}

/** Lines of text-sized skeletons, the last one shorter, like a paragraph. */
export function SkeletonText({ lines, lineHeight, lastWidth = "60%" }: { lines: number; lineHeight: string; lastWidth?: string }) {
  return (
    <span aria-hidden className="skeleton-text" style={{ "--line": lineHeight } as CSSProperties}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? lastWidth : "100%"} height="0.8em" />
      ))}
    </span>
  )
}
