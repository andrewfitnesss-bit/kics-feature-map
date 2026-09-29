// Fail closed: administrators explicitly approve source/API domains.
export function allowedURL(raw: string): URL {
  const url = new URL(raw);
  const allowed = (Deno.env.get('AI_ALLOWED_HOSTS') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !allowed.includes(url.hostname.toLowerCase()) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) {
    throw new Error('Домен не разрешён. Администратор должен добавить его в AI_ALLOWED_HOSTS (HTTPS, точное имя).');
  }
  return url;
}

export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  let url = allowedURL(raw);
  for (let i = 0; i < 4; i++) {
    const addresses = await Deno.resolveDns(url.hostname, 'A');
    if (!addresses.length || addresses.some(ip => {
      const [a,b] = ip.split('.').map(Number);
      return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
    })) throw new Error('Непубличный адрес запрещён');
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || init.method === 'POST') throw new Error('Редирект API запрещён');
    url = allowedURL(new URL(location, url).href);
  }
  throw new Error('Слишком много редиректов');
}

export async function limitedText(response: Response, max = 2000000): Promise<string> {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('Документ слишком большой'); }
  const reader = response.body?.getReader();
  if (!reader) return '';
  let size = 0, result = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error('Документ слишком большой');
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { await reader.cancel(); }
}