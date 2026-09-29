// Never treat internal reasoning or unfinished tool calls as a final answer.
export function parseCompletion(data, provider, model) {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const finish = choice?.finish_reason;
  const raw = message.content;
  const content = (typeof raw === 'string' ? raw : Array.isArray(raw)
    ? raw.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n') : '').trim();
  const details = JSON.stringify({ provider, model, finish: finish || null,
    completionTokens: data?.usage?.completion_tokens ?? null,
    reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    hasReasoning: !!(message.reasoning || message.reasoning_content || message.reasoning_details?.length),
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls.length : 0,
    responseId: typeof data?.id === 'string' ? data.id.slice(0, 150) : null });
  if (data?.error || choice?.error) throw new Error('Провайдер сообщил об ошибке генерации. ' + details);
  if (finish === 'length') throw new Error('Ответ обрезан лимитом токенов. Уменьшите объём задания или отключите ризонинг. ' + details);
  if (message.refusal || finish === 'content_filter') throw new Error('Модель отказалась отвечать. ' + details);
  if (message.tool_calls?.length || finish === 'tool_calls') throw new Error('Модель не завершила вызов инструмента. Выберите другую модель поиска. ' + details);
  if (!content) throw new Error('Модель не вернула итоговый текст. Попробуйте без ризонинга или другую модель; автоматического платного повтора нет. ' + details);
  return { content, annotations: Array.isArray(message.annotations) ? message.annotations : [] };
}