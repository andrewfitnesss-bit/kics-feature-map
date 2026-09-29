// Supabase Edge Function: fetch-url
// Извлекает читаемый текст по URL (обход CORS, который браузер не может сделать сам).
// POST { "url": "https://..." } -> { "title": "...", "text": "...", "byline": "..." }
// Деплой: supabase functions deploy fetch-url

import { createClient } from "npm:@supabase/supabase-js@2";
import { safeFetch, limitedText } from '../_shared/safe-fetch.ts';
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…");
}

function htmlToText(html) {
  let s = html;
  // Убираем скрипты, стили, комментарии, навигацию
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");
  // Блочные элементы -> перенос строки
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Убираем оставшиеся теги
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  // Схлопываем пустые строки и пробелы
  s = s.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Метод не поддерживается" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let url = "";
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) return new Response(JSON.stringify({ error: 'Требуется авторизация' }), { status: 401, headers: CORS });
  const quota = await client.rpc('consume_ai_quota', { p_user: auth.user.id });
  if (quota.error || !quota.data) return new Response(JSON.stringify({ error: 'Лимит запросов' }), { status: 429, headers: CORS });
  try {
    const body = await req.json();
    url = String(body.url || "").trim();
  } catch (_) {
    return new Response(JSON.stringify({ error: "Некорректный JSON" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (!/^https?:\/\//i.test(url)) {
    return new Response(JSON.stringify({ error: "Укажите корректный URL (http/https)" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const resp = await safeFetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; KicsFeatureMap/1.0; +https://kics.example)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "Страница вернула HTTP " + resp.status }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const contentType = resp.headers.get("content-type") || "";
    if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(contentType)) {
      await resp.body?.cancel();
      throw new Error('Поддерживаются HTML и текст. Для PDF загрузите текстовую версию документа.');
    }
    const raw = await limitedText(resp);
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : "";

    let text;
    if (contentType.includes("text/html") || raw.trim().startsWith("<")) {
      text = htmlToText(raw);
    } else {
      text = raw;
    }
    const sources = [url];
    const warnings: string[] = [];
    // Bounded documentation crawl: same origin and URL directory, at most 5 pages.
    const root = new URL(url);
    const prefix = root.pathname.endsWith('/') ? root.pathname : root.pathname.slice(0, root.pathname.lastIndexOf('/') + 1);
    const links = new Set<string>();
    if (contentType.includes('html')) for (const match of raw.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
      try {
        const link = new URL(decodeEntities(match[1]), url); link.hash = '';
        if (link.origin === root.origin && link.pathname.startsWith(prefix) && !link.search && link.href !== root.href && !/\.(pdf|zip|png|jpg|svg)$/i.test(link.pathname)) links.add(link.href);
      } catch (_) { /* malformed link */ }
    }
    text = 'Источник: ' + url + '\n' + text;
    for (const link of Array.from(links).slice(0, 4)) {
      if (text.length >= 180000) break;
      try {
        const page = await safeFetch(link);
        if (!page.ok || !/text\/(html|plain)/i.test(page.headers.get('content-type') || '')) { await page.body?.cancel(); warnings.push('Пропущено: ' + link); continue; }
        text += '\n\nИсточник: ' + link + '\n' + htmlToText(await limitedText(page)); sources.push(link);
      } catch (_) { warnings.push('Не загружено: ' + link); }
    }

    // Ограничиваем объём
    text = text.slice(0, 200000);

    return new Response(
      JSON.stringify({ title, text, sources, warnings, partial: links.size > 4 || text.length >= 200000 }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Не удалось загрузить: " + (e.message || e) }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
