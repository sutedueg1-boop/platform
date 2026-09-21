self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'منصة السلامة والصحة المهنية';
  const options = {
    body: data.body || 'إشعار جديد في المنصة',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [200, 100, 200],
    // بيانات كاملة بتتبعت للتطبيق لو كان فاتح فعلاً (postMessage تحت) —
    // إضافة 14 سبتمبر 2026 — قبل كده كان بس url، فلو التطبيق فاتح في تاب
    // تاني كنا بس بنعمل focus بدون توجيه فعلي لمكان الإشعار.
    data: { url: data.link || data.actionUrl || '/', targetId: data.targetId || null, type: data.type || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // لو التطبيق فاتح أصلاً في أي تاب: نركّز عليه ونبعتله رسالة يوجّه بيها
      // نفسه للمكان الصحيح (بدل ما يقف عند مجرد فتح/تركيز التاب من غير أي
      // توجيه فعلي داخل الصفحة).
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          client.postMessage({ type: 'notification-click', ...notifData });
          return client.focus();
        }
      }
      // مفيش تاب فاتح خالص (التطبيق مقفول تمامًا) — نفتح واحد جديد على
      // الرابط اللي فيه كل بيانات التوجيه كـ query params، وapp.js بيقرأها
      // عند التحميل ويوجّه تلقائيًا.
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});