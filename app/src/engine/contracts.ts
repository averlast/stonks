/** Contract spec. Same 0.25 tick and identical candles across NQ/MNQ/ES/MES;
 *  only `pointValue` differs (SPEC decision 2). Micro↔mini is a later toggle (#19). */
export interface Contract {
  symbol: string;
  tickSize: number;
  pointValue: number; // USD per point
}

export const CONTRACTS: Record<string, Contract> = {
  NQ: { symbol: "NQ", tickSize: 0.25, pointValue: 20 },
  MNQ: { symbol: "MNQ", tickSize: 0.25, pointValue: 2 },
  ES: { symbol: "ES", tickSize: 0.25, pointValue: 50 },
  MES: { symbol: "MES", tickSize: 0.25, pointValue: 5 },
};

/** Fill-model knobs. Commissions + slippage are modeled from day one (SPEC §4):
 *  ignoring them trains over-trading and lies worst when scaling micro→mini. */
export interface FillConfig {
  /** Ticks of adverse slippage applied to market and stop fills (limits/targets fill clean). */
  slippageTicks: number;
  /** USD commission per contract per side (round turn = 2×). Tunable (open param). */
  commissionPerContract: number;
}

export const DEFAULT_FILL_CONFIG: FillConfig = {
  slippageTicks: 1,
  commissionPerContract: 2.5,
};
