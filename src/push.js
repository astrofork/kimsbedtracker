import { api } from "./lib.js";
import { registerServiceWorker } from "./swRegistration.js";

function urlB64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Call after login. Registers SW, asks permission, subscribes to push.
export async function enablePush(vapidPublic) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (!vapidPublic) return false;
  try {
    // Shared with main.jsx's registration — same worker, correct URL in both
    // dev and prod, and no second register() call for the same scope.
    const reg = await registerServiceWorker();
    if (!reg) return false;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(vapidPublic),
      });
    }
    await api.pushSubscribe(sub);
    return true;
  } catch (e) {
    console.warn("Push setup failed:", e);
    return false;
  }
}
