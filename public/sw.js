// BedFlow service worker — handles background push notifications.
// PRE alarms set requireInteraction so they persist on screen until tapped.

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { title: "BedFlow", body: event.data?.text() || "" }; }
  const options = {
    body: data.body || "",
    tag: data.tag || "bedflow",
    requireInteraction: !!data.requireInteraction,
    renotify: true,
    vibrate: data.alarm ? [400, 150, 400, 150, 400] : [200],
    data: { url: "/" },
  };
  event.waitUntil(self.registration.showNotification(data.title || "BedFlow", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
