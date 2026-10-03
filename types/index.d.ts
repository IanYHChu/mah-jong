// Mah-jong's state contract: every value the mod keeps in $.state.
// A tile is a two-character code: m1-m9 萬, p1-p9 筒, s1-s9 條, z1-z7 東南西北中發白, f1-f8 花.
export type Tile = string
// a meld laid down; `concealed` for a kan of four drawn (暗槓), face down to the others
export type Meld = { kind: 'chi' | 'pon' | 'kan'; tiles: Tile[]; concealed?: boolean }
// a call you may make on a bot's discard; `tiles` are the ones it takes from your hand (none for 胡)
export type Claim = { kind: 'hu' | 'chi' | 'pon' | 'kan'; tiles: Tile[] }
// a bot: its concealed tiles, sorted, are drawn only once it wins
export type Seat = { name: string; hand: Tile[]; melds: Meld[]; flowers: Tile[]; river: Tile[] }
// a bot calling out: who (0-2), the call, and a number that grows with each, so a new one shows
export type Shout = { who: number; verb: string; n: number }
// one scoring item: 門清 1, 平胡 2
export type Tai = { name: string; n: number }
// a won hand, to lay open: who (0-2 the bots, 3 you), on what tile (the eighth flower for 八仙過海),
// from whom (null: 自摸), the concealed tiles without the winning one, its 台, and what each player
// (0-3) gains or pays for it
export type Win = { who: number; tile: Tile; from: number | null; hand: Tile[]; melds: Meld[]; flowers: Tile[]; tai: Tai[]; pay: number[] }
// discard: you hold one tile too many; ai: the bots play, `turn` 0-2 (下家 對家 上家), 3 is your draw;
// the next after p is (p + 1) % 4
// claim: a discard waits for your call; over: someone won (`win`), or the wall ran dry
export type Phase = 'discard' | 'ai' | 'claim' | 'over'
export type Table = {
  wall: Tile[]
  hand: Tile[]
  drawn: Tile | null
  cursor: number
  melds: Meld[]
  flowers: Tile[]
  river: Tile[]
  seats: Seat[]
  phase: Phase
  turn: number
  claims: Claim[]
  from: number
  // who threw the river's newest tile, while it still lies there (a call takes it)
  thrown: number | null
  // while a claim is on the tile `from` adds to its pon (加槓): that tile, for 搶槓胡
  robbing: Tile | null
  // a bot's latest call (吃 碰 槓 暗槓 加槓), numbered on across hands, for the band to flash
  shout: Shout | null
  win: Win | null
  event: string
  // who deals (0-3, 3 you; the dealer sits 東), the round wind (0-3, 東南西北), hands the dealer
  // has kept (連莊)
  dealer: number
  wind: number
  streak: number
  // each player's running total (0-3, 3 you), over the hands since /mj-deal
  scores: number[]
  // the current player's last draw was a replacement, after a kan or a flower (槓上開花)
  replaced: boolean
  clickable: boolean
}

declare module 'claude-code' {
  interface PluginState {
    // flash: the shout last seen and the one on show (0: none)
    'mah-jong': { table: Table; isHidden: boolean; isRiverShown: boolean; flash: { seen: number; shown: number } }
  }
}
