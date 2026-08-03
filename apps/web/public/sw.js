self.addEventListener("push", (event) => {
  let payload = { title: "Salus reminder", body: "Open Salus to review your care reminder.", url: "/notifications" };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* Keep a safe generic notification for malformed payloads. */ }
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, data: { url: payload.url }, tag: "salus-reminder" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url === target);
    return existing ? existing.focus() : clients.openWindow(target);
  }));
});
