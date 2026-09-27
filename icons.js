// Chrome's internal favicon endpoint avoids sending site URLs to icon services.
export function faviconURL(pageUrl, runtime = globalThis.chrome?.runtime) {
  if (!runtime?.id || !runtime.getURL) return null;
  try {
    const page = new URL(pageUrl);
    if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password) return null;
    const icon = new URL(runtime.getURL('/_favicon/'));
    icon.searchParams.set('pageUrl', page.href);
    icon.searchParams.set('size', '32');
    return icon.href;
  } catch { return null; }
}

export function createSiteIcon(pageUrl, label, className) {
  const container = document.createElement('span');
  container.className = className;
  container.setAttribute('aria-hidden', 'true');
  const fallback = document.createElement('span');
  fallback.textContent = Array.from(label || '?')[0].toUpperCase();
  container.append(fallback);
  const source = faviconURL(pageUrl);
  if (!source) return container;

  const image = document.createElement('img');
  image.className = 'site-favicon';
  image.alt = '';
  image.width = 24;
  image.height = 24;
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('load', () => container.replaceChildren(image), { once: true });
  image.addEventListener('error', () => container.replaceChildren(fallback), { once: true });
  image.src = source;
  return container;
}
