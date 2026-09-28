// Supabase Edge Function: ai-proxy
// Релей LLM-запросов. Ключ пользователя хранится на сервере (таблица ai_credentials, RLS).
// POST { provider, model, baseURL?, messages, maxTokens } -> { content }
// Требует: supabase functions deploy ai-proxy
// Зависимость: npm:@supabase/supabase-js@2 (ставится автоматически при деплое)

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROVIDERS = {
  openai: { baseURL: "https://api.openai.com/v1", kind: "openai" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", kind: "openai" },
  anthropic: { baseURL: "https://api.anthropic.com/v1", kind: "anthropic" },
  custom: { baseURL: "", kind: "openai" },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function callOpenAI(baseURL, key, model, messages, maxTokens) {
  const resp = await fetch(baseURL.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({ model, messages, stream: false, temperature: 0.4, max_tokens: maxTokens || 2048 }),
  });
  if (!resp.ok) throw new Error("LLM: " + (await resp.text()));
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Пустой ответ модели");
  return content;
}

async function callAnthropic(baseURL, key, model, messages, maxTokens) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const chat = messages.filter((m) => m.role !== "system");
  const resp = await fetch(baseURL.replace(/\/+$/, "") + "/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens || 2048, system: system || undefined, messages: chat }),
  });
  if (!resp.ok) throw new Error("Anthropic: " + (await resp.text()));
  const data = await resp.json();
  return (data.content || []).map((c) => c.text || "").join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Нет авторизации" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let user;
  try {
    const { data } = await supabase.auth.getUser(token);
    user = data.user;
  } catch (_) {
    return json({ error: "Не удалось проверить сессию" }, 401);
  }
  if (!user) return json({ error: "Неавторизованный запрос" }, 401);

  let body;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: "Некорректный JSON" }, 400);
  }

  const provider = body.provider || "openai";
  const cfg = PROVIDERS[provider] || PROVIDERS.openai;
  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (!messages.length) return json({ error: "Пустой запрос" }, 400);

  // Читаем сохранённый ключ пользователя
  let apiKey = "";
  const { data: row, error } = await supabase
    .from("ai_credentials")
    .select("api_key")
    .eq("user_id", user.id)
    .eq("provider", provider)
    .maybeSingle();

  if (error) return json({ error: "Не удалось прочитать ключ: " + error.message }, 500);
  if (!row || !row.api_key) {
    return json({ error: "API-ключ для провайдера не сохранён. Добавьте его в настройках (режим прокси)." }, 400);
  }
  apiKey = row.api_key;

  const baseURL = (provider === "custom" ? body.baseURL : "") || cfg.baseURL;
  if (!baseURL) return json({ error: "Укажите Base URL провайдера" }, 400);

  try {
    const content = cfg.kind === "anthropic"
      ? await callAnthropic(baseURL, apiKey, body.model, messages, body.maxTokens)
      : await callOpenAI(baseURL, apiKey, body.model, messages, body.maxTokens);
    return json({ content });
  } catch (e) {
    return json({ error: e.message || String(e) }, 502);
  }
});
