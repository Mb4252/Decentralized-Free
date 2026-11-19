/**
 * طبقة P2P مبسطة تعتمد على BroadcastChannel للتواصل المحلي بين تبويبات/نوافذ نفس المتصفح،
 * ويمكن استبدالها بـ WebRTC أو libp2p عند الرغبة في التوسع.
 * الهدف: مزامنة السجل والمعاملات بين الأجهزة دون سيرفر مركزي.
 */

export type P2PMessage =
  | { type: 'tx'; payload: any }
  | { type: 'sync-request' }
  | { type: 'sync-response'; payload: any[] };

export class P2PNode {
  private channel: BroadcastChannel;
  private listeners: ((msg: P2PMessage) => void)[] = [];

  constructor(roomId: string) {
    this.channel = new BroadcastChannel(`chronos-p2p-${roomId}`);
    this.channel.onmessage = (event) => {
      const msg = event.data as P2PMessage;
      this.listeners.forEach((l) => l(msg));
    };
  }

  broadcast(msg: P2PMessage): void {
    this.channel.postMessage(msg);
  }

  onMessage(listener: (msg: P2PMessage) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  close(): void {
    this.channel.close();
  }
}
