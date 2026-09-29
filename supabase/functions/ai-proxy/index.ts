// Supabase Edge Function: ai-proxy
// Релей LLM-запросов. Ключ пользователя хранится на сервере (таблица ai_credentials, RLS).
// POST { provider, model, baseURL?, messages, maxTokens } -> { content }
// Требует: supabase functions deploy ai-proxy
// Зависимость: npm:@supabase/supabase-js@2 (ставится автоматически при деплое)

import { createClient } from "npm:@supabase/supabase-js@2";
import { safeFetch, limitedText } from '../_shared/safe-fetch.ts';

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROVIDERS = {
  openai: { baseURL: "https://api.openai.com/v1", kind: "openai" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", kind: "openai" },
  deepseek: { baseURL: "https://api.deepseek.com", kind: "openai" },
  anthropic: { baseURL: "https://api.anthropic.com/v1", kind: "anthropic" },
  custom: { baseURL: "", kind: "openai" },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function callOpenAI(baseURL, key, model, messages, maxTokens, provider, thinking, reasoning, webSearch, searchDomains) {
  const body: any = { model, messages, stream: false, max_tokens: maxTokens || 8192 };
  if (provider === 'openai' && /^(o\d|gpt-5)/.test(model)) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; }
  if (provider === 'openrouter') body.reasoning = { enabled: reasoning || thinking };
  if (provider === 'openrouter' && webSearch) body.tools = [{ type: 'openrouter:web_search', parameters: { allowed_domains: searchDomains, max_total_results: 8 } }];
  // DeepSeek: включаем «размышления» только при явном запросе ризонинга.
  if (provider === "deepseek") body.thinking = { type: thinking ? "enabled" : "disabled" };

  const resp = await (provider === 'custom' ? safeFetch : fetch)(baseURL.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) throw new Error("LLM: " + (await resp.text()));
  const data = JSON.parse(await limitedText(resp));
  const choice = data.choices?.[0];
  let content = choice?.message?.content;
  if (!content) {
    throw new Error("Пустой ответ модели (finish_reason: " + (choice?.finish_reason || "?") + ")");
  }
  if (choice?.finish_reason === 'length') throw new Error('Ответ обрезан лимитом токенов. Уменьшите объём задания.');
  return { content, annotations: choice?.message?.annotations || [] };
}

async function callAnthropic(baseURL, key, model, messages, maxTokens, thinking) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const chat = messages.filter((m) => m.role !== "system");
  const resp = await fetch(baseURL.replace(/\/+$/, "") + "/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens || 8192, thinking: thinking ? { type: 'enabled', budget_tokens: 2048 } : undefined, system: system || undefined, messages: chat }),
    redirect: 'error', signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) throw new Error("Anthropic: " + (await resp.text()));
  const data = await resp.json();
  return { content: (data.content || []).map((c) => c.text || "").join(""), annotations: [] };
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
  const quota = await supabase.rpc('consume_ai_quota', { p_user: user.id });
  if (quota.error || !quota.data) return json({ error: 'Лимит запросов' }, 429);

  let body;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: "Некорректный JSON" }, 400);
  }

  const provider = body.provider || "openai";
  if (body.searchDomains !== undefined && (!Array.isArray(body.searchDomains) || body.searchDomains.length > 5 || body.searchDomains.some(d => typeof d !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)))) return json({ error: 'Некорректные домены поиска' }, 400);
  if (!Object.hasOwn(PROVIDERS, provider)) return json({ error: 'Неизвестный провайдер' }, 400);
  if (typeof body.model !== 'string' || !body.model || JSON.stringify(body.messages || []).length > 150000 ||
      (body.maxTokens && (!Number.isInteger(body.maxTokens) || body.maxTokens < 1 || body.maxTokens > 32000))) return json({ error: 'Некорректные параметры' }, 400);
  const cfg = PROVIDERS[provider] || PROVIDERS.openai;
  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (!messages.length) return json({ error: "Пустой запрос" }, 400);

  // Читаем сохранённый ключ пользователя
  let apiKey = "";
  const { data: secret, error } = await supabase.rpc('read_ai_credential', { p_user: user.id, p_provider: provider });
  const row = { api_key: secret };

  if (error) return json({ error: "Не удалось прочитать ключ: " + error.message }, 500);
  if (!row || !row.api_key) {
    return json({ error: "API-ключ для провайдера не сохранён. Добавьте его в настройках (режим прокси)." }, 400);
  }
  apiKey = row.api_key;

  const baseURL = (provider === "custom" ? body.baseURL : "") || cfg.baseURL;
  if (!baseURL) return json({ error: "Укажите Base URL провайдера" }, 400);

  try {
    const content = cfg.kind === "anthropic"
      ? await callAnthropic(baseURL, apiKey, body.model, messages, body.maxTokens, !!body.thinking)
      : await callOpenAI(baseURL, apiKey, body.model, messages, body.maxTokens, provider, !!body.thinking, !!body.reasoning, !!body.webSearch, body.searchDomains);
    return json(content);
  } catch (e) {
    return json({ error: e.message || String(e) }, 502);
  }
});
