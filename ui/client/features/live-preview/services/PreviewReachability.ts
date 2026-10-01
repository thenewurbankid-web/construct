/** Is anything answering at the preview address?
 *
 * A `no-cors` request tells us only whether the connection succeeded — which is
 * the point: the Cockpit never reads the app under development, it only asks
 * whether its dev server is up, so a stopped server gets a plain explanation
 * instead of a blank white rectangle. Anything but a clear refusal counts as
 * reachable: a preview that works must never be withheld because this probe
 * was unlucky. */
export async function probePreview(url: string): Promise<boolean> {
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', redirect: 'follow' });
    return true;
  } catch {
    return false;
  }
}
