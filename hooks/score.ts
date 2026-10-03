// 台數 for a won hand, after 明星3缺1's 16-tile table, played the common way: a flower scores only as
// your own (正花), a wind triplet only as your seat's or the round's. Left out: the declared-ready
// items (聽牌 天聽 地聽), which nobody can declare yet. Where the concealed tiles split more
// than one way, the split scoring most stands.
import type { Meld, Tai, Tile } from '../types'
import { type Group, slot, splits, waits } from './hand'

export type WinFacts = {
  hand: readonly Tile[] // concealed, without the winning tile
  tile: Tile
  melds: readonly Meld[]
  flowers: readonly Tile[]
  selfDrawn: boolean // 自摸
  seatWind: number // 0-3, 東南西北
  roundWind: number
  isDealer: boolean
  dealerPays: boolean // the dealer won, or threw the tile
  streak: number // 連莊
  first: boolean // the winner's first draw, nobody having called: 天胡 for the dealer, 地胡 else
  last: boolean // the wall's last tile
  replaced: boolean // drawn after a kan or a flower
  eightFlowers: boolean // 八仙過海
  robbed: boolean // won on the tile another added to its pon (搶槓胡)
}

const DRAGONS = [31, 32, 33]
const WINDS = [27, 28, 29, 30]

// what does not hang on how the concealed tiles split
function fixed(f: WinFacts): Tai[] {
  const out: Tai[] = []
  if (f.dealerPays) {
    out.push({ name: '莊家', n: 1 })
    if (f.streak) out.push({ name: `連${f.streak}拉${f.streak}`, n: 2 * f.streak })
  }
  for (const k of [f.seatWind + 1, f.seatWind + 5]) if (f.flowers.includes(`f${k}`)) out.push({ name: '花牌', n: 1 })
  if ([1, 2, 3, 4].every(k => f.flowers.includes(`f${k}`))) out.push({ name: '春夏秋冬', n: 2 })
  if ([5, 6, 7, 8].every(k => f.flowers.includes(`f${k}`))) out.push({ name: '梅蘭竹菊', n: 2 })
  return out
}

export function score(f: WinFacts): Tai[] {
  if (f.eightFlowers) return [...fixed(f).filter(t => t.name === '莊家' || t.name.startsWith('連')), { name: '八仙過海', n: 8 }]
  const all = [...f.hand, f.tile]
  const open = f.melds.filter(m => !m.concealed)
  // the laid-down melds as groups; a 暗槓 counts as concealed
  const laid = f.melds.map(m => ({ set: m.kind !== 'chi', slot: Math.min(...m.tiles.map(slot)), concealed: !!m.concealed }))
  const single = !f.first && waits(f.hand).length === 1
  let best: Tai[] = []
  for (const sp of splits(all)) {
    const tai = [...fixed(f), ...bySplit(f, sp.pair, sp.groups, laid, open.length === 0)]
    if (single) tai.push({ name: '獨聽', n: 1 })
    if (total(tai) > total(best) || !best.length) best = tai
  }
  return best
}

export const total = (tai: readonly Tai[]) => tai.reduce((n, t) => n + t.n, 0)

// the stakes: each payment is the base (底) and so much a 台
export const BASE = 100
export const PER_TAI = 20

// who pays whom: on a discard (or a robbed kan) the thrower alone, on 自摸 the other three. The
// dealer's 台 (莊家, 連N拉N) count only where the dealer pays or is paid
export function payments(tai: readonly Tai[], winner: number, from: number | null, dealer: number): number[] {
  const dealers = total(tai.filter(t => t.name === '莊家' || t.name.startsWith('連')))
  const rest = total(tai) - dealers
  const pay = [0, 0, 0, 0]
  for (const q of from === null ? [0, 1, 2, 3].filter(q => q !== winner) : [from]) {
    const n = BASE + PER_TAI * (rest + (q === dealer || winner === dealer ? dealers : 0))
    pay[q]! -= n
    pay[winner]! += n
  }
  return pay
}

function bySplit(f: WinFacts, pair: number, concealed: Group[], laid: (Group & { concealed: boolean })[], closed: boolean): Tai[] {
  const out: Tai[] = []
  const at = slot(f.tile)
  // won on a discard, a triplet of the winning tile was finished in the open, unless the tile could
  // have finished the pair or a run instead
  const openedSet = !f.selfDrawn && pair !== at && !concealed.some(g => !g.set && at >= g.slot && at <= g.slot + 2)
  const groups = [
    ...concealed.map(g => ({ ...g, concealed: !(openedSet && g.set && g.slot === at) })),
    ...laid,
  ]
  const sets = groups.filter(g => g.set).map(g => g.slot)

  if (f.first) out.push(f.isDealer ? { name: '天胡', n: 24 } : { name: '地胡', n: 16 })
  else {
    if (closed && f.selfDrawn) out.push({ name: '門清自摸', n: 3 })
    else if (closed) out.push({ name: '門清', n: 1 })
    else if (f.selfDrawn) out.push({ name: '自摸', n: 1 })
  }

  const dragons = DRAGONS.filter(d => sets.includes(d)).length
  if (dragons === 3) out.push({ name: '大三元', n: 8 })
  else if (dragons === 2 && DRAGONS.includes(pair)) out.push({ name: '小三元', n: 4 })
  else for (let k = 0; k < dragons; k++) out.push({ name: '三元牌', n: 1 })

  const winds = WINDS.filter(w => sets.includes(w)).length
  if (winds === 4) out.push({ name: '大四喜', n: 16 })
  else if (winds === 3 && WINDS.includes(pair)) out.push({ name: '小四喜', n: 8 })
  else {
    if (sets.includes(WINDS[f.seatWind]!)) out.push({ name: '門風', n: 1 })
    if (sets.includes(WINDS[f.roundWind]!)) out.push({ name: '圈風', n: 1 })
  }

  const hidden = groups.filter(g => g.set && g.concealed).length
  if (hidden >= 5) out.push({ name: '五暗刻', n: 8 })
  else if (hidden === 4) out.push({ name: '四暗刻', n: 5 })
  else if (hidden === 3) out.push({ name: '三暗刻', n: 2 })

  if (groups.every(g => g.set)) out.push({ name: '碰碰胡', n: 4 })
  if (groups.every(g => !g.set) && pair < 27) out.push({ name: '平胡', n: 2 })

  const tiles = [...f.hand, f.tile, ...f.melds.flatMap(m => m.tiles)]
  const suits = new Set(tiles.filter(t => t[0] !== 'z').map(t => t[0]))
  const honors = tiles.some(t => t[0] === 'z')
  if (suits.size === 0 || (suits.size === 1 && !honors)) out.push({ name: '清一色', n: 8 })
  else if (suits.size === 1) out.push({ name: '混一色', n: 4 })

  // 全求: one tile left, the rest called, won on a discard
  if (f.hand.length === 1 && !f.selfDrawn && f.melds.every(m => !m.concealed)) out.push({ name: '全求', n: 2 })
  if (f.selfDrawn && f.last) out.push({ name: '海底撈月', n: 1 })
  if (f.selfDrawn && f.replaced) out.push({ name: '槓上開花', n: 1 })
  if (f.robbed) out.push({ name: '搶槓胡', n: 1 })
  return out
}
