export interface Level {
  level: number
  name: string
  /** Percent off the default wholesale price. */
  discount: number
}

export const LEVELS: Level[] = [
  { level: 1, name: "Level 1", discount: 0 },
  { level: 2, name: "Level 2", discount: 10 },
  { level: 3, name: "Level 3", discount: 25 },
]

/**
 * Levels are customer groups in Quickbutik. A customer with no group is on
 * Level 1; otherwise the level is read from the group's name ("Level 2", "Nivå 3", "L3"…).
 */
export function levelForGroup(groupName: string | null | undefined): Level {
  const number = Number(/(\d+)/.exec(groupName ?? "")?.[1])
  return LEVELS.find((l) => l.level === number) ?? LEVELS[0]
}
