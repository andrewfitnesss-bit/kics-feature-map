// Supabase Edge Function: fetch-url
// Извлекает читаемый текст по URL (обход CORS, который браузер не может сделать сам).
// POST { "url": "https://..." } -> { "title": "...", "text": "...", "byline": "..." }
// Деплой: supabase functions deploy fetch-url

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
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; KicsFeatureMap/1.0; +https://kics.example)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "Страница вернула HTTP " + resp.status }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const contentType = resp.headers.get("content-type") || "";
    const raw = await resp.text();
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : "";

    let text;
    if (contentType.includes("text/html") || raw.trim().startsWith("<")) {
      text = htmlToText(raw);
    } else {
      text = raw;
    }

    // Ограничиваем объём
    text = text.slice(0, 200000);

    return new Response(
      JSON.stringify({ title, text }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Не удалось загрузить: " + (e.message || e) }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
