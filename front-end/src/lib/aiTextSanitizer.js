const EMPTY_PRAISE_PATTERNS = [
  /^老人家今天[^。！？\n]{0,30}(?:挺认真|很认真)[，,。！!\s]*/,
  /^今天[^。！？\n]{0,30}(?:挺认真|很认真)[，,。！!\s]*/,
  /^(?:这次)?测试[^。！？\n]{0,12}顺利完成(?:了)?[，,。！!\s]*/,
  /^先给您点个赞[，,。！!\s]*/,
  /^先点个赞[，,。！!\s]*/,
  /^先表扬一下[，,。！!\s]*/,
];

export function sanitizeAiText(value) {
  if (typeof value !== 'string') return value;

  let text = value.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of EMPTY_PRAISE_PATTERNS) {
      const next = text.replace(pattern, '').replace(/^[ ，,。！!；;]+/, '');
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }
  return text;
}

export function sanitizeAiReport(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeAiReport);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeAiReport(item)]),
    );
  }
  return sanitizeAiText(value);
}
