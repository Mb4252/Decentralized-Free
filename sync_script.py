import os
import requests

# قراءة قائمة العقد من متغير البيئة
peers = os.environ.get('PEERS', '').split(',')
for peer in peers:
    peer = peer.strip()
    if not peer:
        continue
    try:
        # طلب مزامنة من كل عقدة
        requests.post(f"{peer}/sync", timeout=10)
        print(f"✅ طلب مزامنة لـ {peer}")
    except Exception as e:
        print(f"⚠️ فشل مزامنة {peer}: {e}")
