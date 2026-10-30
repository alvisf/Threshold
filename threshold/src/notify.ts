export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;

export async function askPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!canNotify()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/** Low-stimulation alert: silent, one tag so a new alert replaces the old one. */
export async function notifyBucket(body: string): Promise<boolean> {
  if (!canNotify() || Notification.permission !== 'granted') return false;
  const opts: NotificationOptions = { body, silent: true, tag: 'threshold-bucket', icon: 'icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification('Threshold', opts); return true; }
    new Notification('Threshold', opts);
    return true;
  } catch {
    return false;
  }
}
