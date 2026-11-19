import { PriceReport, BarterOffer } from './types';

// نستخدم BroadcastChannel للمزامنة بين التبويبات (في نفس الجهاز)
// وللمزامنة عبر الإنترنت، يمكن استخدام WebRTC أو Gun.js لاحقاً.
// هنا نستخدم غرفة المزامنة (Room) اللامركزية.

export class SyncEngine {
  private channel: BroadcastChannel;
  private roomId: string;

  constructor(roomId: string = 'sudan-fair-price-room') {
    this.roomId = roomId;
    // نستخدم غرفة مشتركة لتبادل البلاغات بين التبويبات في نفس المتصفح
    if (typeof window !== 'undefined') {
      this.channel = new BroadcastChannel(this.roomId);
    }
  }

  // إرسال بلاغ سعر جديد
  broadcastPrice(report: PriceReport) {
    if (this.channel) {
      this.channel.postMessage({ type: 'NEW_PRICE', payload: report });
    }
  }

  // إرسال عرض مقايضة جديد
  broadcastBarter(offer: BarterOffer) {
    if (this.channel) {
      this.channel.postMessage({ type: 'NEW_BARTER', payload: offer });
    }
  }

  // استقبال البيانات
  onMessage(callback: (type: string, payload: any) => void) {
    if (!this.channel) return;
    this.channel.onmessage = (event) => {
      callback(event.data.type, event.data.payload);
    };
  }

  close() {
    if (this.channel) this.channel.close();
  }
}
