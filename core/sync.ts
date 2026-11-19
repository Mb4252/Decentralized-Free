export class SyncEngine {
  private channel: BroadcastChannel | null = null;
  private roomId: string;

  constructor(roomId: string = 'sudan-fair-price-room') {
    this.roomId = roomId;

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel(this.roomId);
    }
  }

  public send(data: unknown): void {
    if (this.channel) {
      this.channel.postMessage(data);
    }
  }

  public onMessage(callback: (event: MessageEvent) => void): void {
    if (this.channel) {
      this.channel.onmessage = callback;
    }
  }

  public close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}
