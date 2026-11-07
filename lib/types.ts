export type OrderSide = 'buy' | 'sell'
export type OrderStatus = 'open' | 'matched' | 'paid' | 'released' | 'cancelled'

export interface Order {
  id: string
  user_id: string
  side: OrderSide
  price: number
  amount: number
  status: OrderStatus
  payment_ref: string | null
  receipt_url: string | null
  escrow_locked: boolean
  created_at: string
  updated_at: string
}

export interface Trade {
  id: string
  buy_order_id: string
  sell_order_id: string
  price: number
  amount: number
  executed_at: string
}

export interface Candle {
  id: number
  timeframe: '15m' | '4h' | '1d'
  open_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MarketStats {
  price: number
  volume24h: number
  liquidity: number
}
