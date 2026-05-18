// Service Worker for Web Push Notifications — Nexe
self.addEventListener("push", function (event) {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || "",
      icon: data.icon || "/favicon.png",
      badge: "/favicon.png",
      tag: data.tag || "nexe-notification",
      data: { url: data.url },
    };

    event.waitUntil(self.registration.showNotification(data.title || "Nexe", options));
  } catch {
    // Fallback for plain text push
    event.waitUntil(
      self.registration.showNotification("Nexe", {
        body: event.data.text(),
        icon: "/favicon.png",
      })
    );
  }
});

// Click on notification -> open/focus the app
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
