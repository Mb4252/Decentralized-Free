export interface SyncEnvelope {
  type: string;
  payload: any;
}

export class SyncEngine {
  private channel: BroadcastChannel | null = null;
  private roomId: string;

  constructor(roomId: string = 'sudan-fair-price-room') {
    this.roomId = roomId;

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel(this.roomId);
    }
  }

  public send(type: string, payload: any): void {
    if (this.channel) {
      const message: SyncEnvelope = { type, payload };
      this.channel.postMessage(message);
    }
  }

  public broadcastPrice(priceReport: any): void {
    this.send('NEW_PRICE', priceReport);
  }

  public broadcastBarter(barterOffer: any): void {
    this.send('NEW_BARTER', barterOffer);
  }

  public broadcast(type: string, payload: any): void {
    this.send(type, payload);
  }

  public onMessage(callback: (type: string, payload: any) => void): void {
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent) => {
        const data = event.data as SyncEnvelope | undefined;
        if (data && typeof data.type === 'string') {
          callback(data.type, data.payload);
        }
      };
    }
  }

  public close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}
