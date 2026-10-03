// Whether concealed tiles complete a hand: melds (three of a kind, or a run within one suit) and
// one pair. The melds laid down are already melds, so only the concealed tiles are checked; with
// five down, the pair alone is left. Special hands (嚦咕嚦咕, 八仙過海) come with the scoring.
// Also how far a hand is from winning (shanten), and the tile a bot throws.
import type { Tile } from '../types'

// a tile's slot among the 34 kinds: 萬 0-8, 筒 9-17, 條 18-26, honors 27-33
function slot(t: Tile): number {
  const base = { m: 0, p: 9, s: 18, z: 27 }[t[0] as 'm' | 'p' | 's' | 'z']
  return base === undefined ? -1 : base + Number(t.slice(1)) - 1
}

function counts(ts: readonly Tile[]): number[] | null {
  const c = new Array<number>(34).fill(0)
  for (const t of ts) {
    const i = slot(t)
    if (i < 0) return null
    c[i]!++
  }
  return c
}

// every tile used up as melds, taking the lowest tile first: as a triplet, or as the start of a run
function allMelds(c: number[]): boolean {
  const i = c.findIndex(n => n > 0)
  if (i < 0) return true
  if (c[i]! >= 3) {
    c[i]! -= 3
    const ok = allMelds(c)
    c[i]! += 3
    if (ok) return true
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1]! > 0 && c[i + 2]! > 0) {
    c[i]!--, c[i + 1]!--, c[i + 2]!--
    const ok = allMelds(c)
    c[i]!++, c[i + 1]!++, c[i + 2]!++
    if (ok) return true
  }
  return false
}

// a complete hand split one way: the pair's slot, and each meld as a triplet (set) or a run from
// its lowest slot
export type Group = { set: boolean; slot: number }
export type Split = { pair: number; groups: Group[] }

// every way the concealed tiles split into melds and one pair; none when they do not
export function splits(concealed: readonly Tile[]): Split[] {
  const c = counts(concealed)
  if (!c || concealed.length % 3 !== 2) return []
  const out: Split[] = []
  const groups: Group[] = []
  const walk = (pair: number) => {
    const i = c.findIndex(n => n > 0)
    if (i < 0) return void out.push({ pair, groups: [...groups] })
    if (c[i]! >= 3) {
      c[i]! -= 3, groups.push({ set: true, slot: i })
      walk(pair)
      c[i]! += 3, groups.pop()
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1]! > 0 && c[i + 2]! > 0) {
      c[i]!--, c[i + 1]!--, c[i + 2]!--, groups.push({ set: false, slot: i })
      walk(pair)
      c[i]!++, c[i + 1]!++, c[i + 2]!++, groups.pop()
    }
  }
  for (let i = 0; i < 34; i++) {
    if (c[i]! < 2) continue
    c[i]! -= 2
    walk(i)
    c[i]! += 2
  }
  return out
}

// the tiles that would complete a hand of 3n+1
export function waits(concealed: readonly Tile[]): Tile[] {
  const out: Tile[] = []
  for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) if (isWinning([...concealed, `${s}${n}`])) out.push(`${s}${n}`)
  for (let n = 1; n <= 7; n++) if (isWinning([...concealed, `z${n}`])) out.push(`z${n}`)
  return out
}

export { slot }

export function isWinning(concealed: readonly Tile[]): boolean {
  if (concealed.length % 3 !== 2) return false
  const c = counts(concealed)
  if (!c) return false
  for (let i = 0; i < 34; i++) {
    if (c[i]! < 2) continue
    c[i]! -= 2
    const ok = allMelds(c)
    c[i]! += 2
    if (ok) return true
  }
  return false
}

// how many tiles short of ready (聽牌) the concealed tiles are: 0 ready, -1 complete. They need
// floor(n / 3) melds; each meld counts two, each partial (a pair, 45, 46) one, the pair one more
export function shanten(concealed: readonly Tile[]): number {
  const c = counts(concealed)
  if (!c) return Infinity
  const need = Math.floor(concealed.length / 3)
  const memo = new Map<string, number>()
  // the most melds (two each) and partials (one each) from slot i on, with m and p already taken
  const most = (i: number, m: number, p: number): number => {
    while (i < 34 && c[i] === 0) i++
    if (i === 34) return 2 * m + Math.min(p, need - m)
    const key = `${i}:${m}:${p}:${c.slice(i).join('')}`
    const known = memo.get(key)
    if (known !== undefined) return known
    const run = i < 27 && i % 9 <= 6
    const pairable = i < 27 && i % 9 <= 7
    let best = 0
    const tryTake = (take: [number, number][], dm: number, dp: number) => {
      if (take.some(([k, n]) => c[k]! < n)) return
      for (const [k, n] of take) c[k]! -= n
      best = Math.max(best, most(i, m + dm, p + dp))
      for (const [k, n] of take) c[k]! += n
    }
    // a meld past the limit still pays, standing in for a partial
    if (m < need) {
      tryTake([[i, 3]], 1, 0)
      if (run) tryTake([[i, 1], [i + 1, 1], [i + 2, 1]], 1, 0)
    }
    if (m + p < need) {
      tryTake([[i, 2]], 0, 1)
      if (pairable) tryTake([[i, 1], [i + 1, 1]], 0, 1)
      if (run) tryTake([[i, 1], [i + 2, 1]], 0, 1)
    }
    // or leave this slot's tiles loose
    const n = c[i]!
    c[i] = 0
    best = Math.max(best, most(i + 1, m, p))
    c[i] = n
    memo.set(key, best)
    return best
  }
  let best = 2 * need - most(0, 0, 0)
  for (let i = 0; i < 34; i++) {
    if (c[i]! < 2) continue
    c[i]! -= 2
    memo.clear()
    best = Math.min(best, 2 * need - most(0, 0, 0) - 1)
    c[i]! += 2
  }
  return best
}

// how much a tile leans on its neighbours: the same tile, then one and two apart in its suit
function ties(c: number[], i: number): number {
  let n = (c[i]! - 1) * 4
  if (i < 27) {
    const r = i % 9
    if (r >= 1) n += c[i - 1]! * 2
    if (r <= 7) n += c[i + 1]! * 2
    if (r >= 2) n += c[i - 2]!
    if (r <= 6) n += c[i + 2]!
  }
  return n
}

// each tile a hand of 3n+2 might throw, with how far from ready that leaves it and how loose the
// tile is (its ties to neighbours, then honors before terminals before the middle)
export type Throw = { tile: Tile; shanten: number; loose: number[] }

export function throws(concealed: readonly Tile[]): Throw[] {
  const c = counts(concealed)!
  return [...new Set(concealed)].map(t => {
    const i = slot(t)
    const r = i % 9
    const rest = [...concealed]
    rest.splice(rest.indexOf(t), 1)
    return { tile: t, shanten: shanten(rest), loose: [ties(c, i), i >= 27 ? 0 : r === 0 || r === 8 ? 1 : 2] }
  })
}

// the tile to throw: the one leaving the hand fewest tiles from ready; among those, the loosest
export function bestDiscard(concealed: readonly Tile[]): Tile {
  return pickBy(throws(concealed), w => [w.shanten, ...w.loose]).tile
}

// the item whose key sorts first, comparing key by key
export function pickBy<T>(items: readonly T[], key: (item: T) => number[]): T {
  let pick: T = items[0]!
  let best = key(pick)
  for (const item of items.slice(1)) {
    const k = key(item)
    if (before(k, best)) (pick = item, best = k)
  }
  return pick
}

const before = (a: number[], b: number[]) => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k]! < b[k]!
  return false
}
