/**
 * Shared runtime helpers for the session-scoped Cognitive Buffer (Notepad).
 *
 * The buffer stores raw markdown-ish content plus derived structured items
 * so route handlers, tool handlers, and persistence can share one contract.
 */

const CATEGORY_PREFIX = Object.freeze({
  task: '- [ ] ',
  constraint: '⚠️ ',
  progress: '✓ ',
  note: '📝 ',
});
const VISUAL_CONTEXT_PATTERN = /\b(annotat(?:e|ion)?|arrow(?:s)?|color(?:s)?|diagram(?:s)?|figure(?:s)?|image(?:s)?|illustrat(?:e|ion|ive)?|label(?:s|ed)?|layout|render(?:ing)?|sketch(?:es)?|style|visual(?:s)?)\b/i;
const DEFAULT_DEEPTUTOR_NOTEPAD_ITEM_LIMIT = 8;
const DEFAULT_DEEPTUTOR_NOTEPAD_ITEM_MAX_CHARS = 180;

function normalizeInlineText(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function resolveNotepadMainTask(...values) {
  for (const value of values) {
    const normalized = normalizeInlineText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function clipInlineText(value, maxChars = DEFAULT_DEEPTUTOR_NOTEPAD_ITEM_MAX_CHARS) {
  if (!value || value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function isVisualNotepadText(text = '') {
  return VISUAL_CONTEXT_PATTERN.test(String(text ?? ''));
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && !value.trim()) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNotepadItems(content = '') {
  const items = [];
  const normalized = String(content ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  let currentSection = 'general';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^#{2,3}\s+(.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase().trim();
      continue;
    }

    const taskMatch = trimmed.match(/^[-*]\s*\[\s*([xX ])\s*\]\s*(.+)$/);
    if (taskMatch) {
      items.push({
        type: 'task',
        section: currentSection,
        checked: taskMatch[1] === 'x' || taskMatch[1] === 'X',
        text: taskMatch[2].trim(),
      });
      continue;
    }

    const constraintMatch = trimmed.match(/^⚠️?\s*(.+)$/);
    if (constraintMatch) {
      items.push({
        type: 'constraint',
        section: currentSection,
        text: constraintMatch[1].trim(),
      });
      continue;
    }

    const progressMatch = trimmed.match(/^[✓✔√]\s*(.+)$/);
    if (progressMatch) {
      items.push({
        type: 'progress',
        section: currentSection,
        text: progressMatch[1].trim(),
      });
      continue;
    }

    const noteMatch = trimmed.match(/^[📝💡📌]\s*(.+)$/);
    if (noteMatch) {
      items.push({
        type: 'note',
        section: currentSection,
        text: noteMatch[1].trim(),
      });
    }
  }

  return items;
}

function extractVisualNotepadContext(content = '') {
  const lines = String(content ?? '').split('\n');
  const kept = [];
  let inVisualSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inVisualSection && kept.length > 0 && kept[kept.length - 1] !== '') {
        kept.push('');
      }
      continue;
    }

    const sectionMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (sectionMatch) {
      inVisualSection = VISUAL_CONTEXT_PATTERN.test(sectionMatch[1]);
      if (inVisualSection) {
        kept.push(trimmed);
      }
      continue;
    }

    if (inVisualSection || VISUAL_CONTEXT_PATTERN.test(trimmed)) {
      kept.push(trimmed);
    }
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function formatDeepTutorNotepadItem(item, maxCharsPerItem) {
  const text = normalizeInlineText(item?.text);
  if (!text) {
    return '';
  }

  const section = normalizeInlineText(item?.section);
  const sectionPrefix = section && section.toLowerCase() !== 'general'
    ? `${section}: `
    : '';

  return clipInlineText(`${sectionPrefix}${text}`, maxCharsPerItem);
}

function extractDeepTutorNotepadContext(value, options = {}) {
  const maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0
    ? options.maxItems
    : DEFAULT_DEEPTUTOR_NOTEPAD_ITEM_LIMIT;
  const maxCharsPerItem = Number.isInteger(options.maxCharsPerItem) && options.maxCharsPerItem > 24
    ? options.maxCharsPerItem
    : DEFAULT_DEEPTUTOR_NOTEPAD_ITEM_MAX_CHARS;
  const includeVisual = options.includeVisual === true;
  const normalized = normalizeNotepadState(value, {
    fallbackMainTask: options.mainTask,
  });
  const buckets = {
    tasks: [],
    constraints: [],
    notes: [],
    progress: [],
  };
  const seen = new Set();

  function push(bucketName, item) {
    const formatted = formatDeepTutorNotepadItem(item, maxCharsPerItem);
    if (!formatted) {
      return;
    }
    const key = formatted.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    buckets[bucketName].push(`- ${formatted}`);
  }

  for (const item of normalized.items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const itemText = normalizeInlineText(item.text);
    const itemSection = normalizeInlineText(item.section);
    if (!includeVisual && (isVisualNotepadText(itemText) || isVisualNotepadText(itemSection))) {
      continue;
    }

    if (item.type === 'task') {
      push(item.checked ? 'progress' : 'tasks', item);
      continue;
    }
    if (item.type === 'constraint') {
      push('constraints', item);
      continue;
    }
    if (item.type === 'progress') {
      push('progress', item);
      continue;
    }
    if (item.type === 'note') {
      push('notes', item);
    }
  }

  const lines = [];
  if (normalized.mainTask) {
    lines.push(`Main task: ${clipInlineText(normalized.mainTask, maxCharsPerItem)}`);
  }

  let remaining = maxItems;
  function appendBucket(title, entries) {
    if (!entries.length || remaining <= 0) {
      return;
    }
    const selected = entries.slice(0, remaining);
    lines.push(title, ...selected);
    remaining -= selected.length;
  }

  appendBucket('Open tasks:', buckets.tasks);
  appendBucket('Constraints:', buckets.constraints);
  appendBucket('Key notes:', buckets.notes);
  appendBucket('Recent progress:', buckets.progress);

  return lines.join('\n').trim();
}

function createDefaultNotepadState(overrides = {}, options = {}) {
  const content = typeof overrides?.content === 'string' ? overrides.content : '';
  const lastModified = normalizeOptionalNumber(overrides?.lastModified);
  const versionValue = normalizeOptionalNumber(overrides?.version);
  const version = versionValue !== null
    ? Math.max(1, Math.floor(versionValue))
    : 1;
  const mainTask = resolveNotepadMainTask(overrides?.mainTask, options?.fallbackMainTask);

  return {
    content,
    items: parseNotepadItems(content),
    lastModified,
    version,
    isBeingEdited: overrides?.isBeingEdited === true,
    mainTask,
  };
}

function normalizeNotepadState(value, options = {}) {
  if (!value || typeof value !== 'object') {
    return createDefaultNotepadState({}, options);
  }
  return createDefaultNotepadState(value, options);
}

function canonicalizeSessionNotepadState(sessionLike = {}, options = {}) {
  const normalized = normalizeNotepadState(sessionLike?.notepad, {
    fallbackMainTask: sessionLike?.mainTask,
  });
  const notepad = options.preserveEditState === true
    ? normalized
    : {
        ...normalized,
        isBeingEdited: false,
      };
  return {
    notepad,
    mainTask: notepad.mainTask || '',
  };
}

function ensureSessionNotepad(session) {
  const normalized = normalizeNotepadState(session?.notepad);
  if (session && session.notepad !== normalized) {
    session.notepad = normalized;
  }
  return normalized;
}

function getNotepadBudget(session = {}) {
  const systemReserve = session.contextBudget?.systemReserve || 6000;
  const notepadMaxTokens = Math.floor(systemReserve * 0.60);
  return { notepadMaxTokens };
}

function estimateTokens(text = '') {
  return Math.ceil(String(text).length / 4);
}

function taskKeywords(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 24);
}

function overlapsTask(line = '', keywords = []) {
  if (!keywords.length) return true;
  const lower = String(line).toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function trimToTokenBudget(content, maxTokens) {
  const tokenEstimate = estimateTokens(content);
  if (tokenEstimate <= maxTokens) {
    return { content, tokenEstimate, truncated: false };
  }

  const maxChars = maxTokens * 4;
  let finalContent = content.slice(0, maxChars);
  // Snap to line boundary — use 30% threshold to avoid cutting mid-item
  const lastNewline = finalContent.lastIndexOf('\n');
  if (lastNewline > maxChars * 0.3) {
    finalContent = finalContent.slice(0, lastNewline);
  }
  finalContent += '\n\n⚠️ [Notepad truncated — exceeded token budget]';
  return { content: finalContent, tokenEstimate, truncated: true };
}

function compactForCurrentTask(content = '', currentTask = '') {
  if (!content) return { content: '', removedLines: 0 };

  const keywords = taskKeywords(currentTask);
  const normalized = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const kept = [];
  const staleProgress = [];
  const staleNotes = [];
  let removedLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }

    const isHeading = /^#{1,6}\s/.test(trimmed);
    const isConstraint = trimmed.startsWith('⚠️');
    const isActiveTask = /^-\s*\[\s\]\s+/.test(trimmed);
    const isDoneTask = /^-\s*\[[xX]\]\s+/.test(trimmed);
    const isProgress = trimmed.startsWith('✓');
    const isNote = trimmed.startsWith('📝') || trimmed.startsWith('💡') || trimmed.startsWith('📌');

    if (isHeading || isConstraint || isActiveTask) {
      kept.push(line);
      continue;
    }

    if (isDoneTask || isProgress) {
      if (overlapsTask(trimmed, keywords)) kept.push(line);
      else staleProgress.push(line);
      continue;
    }

    if (isNote) {
      if (overlapsTask(trimmed, keywords)) kept.push(line);
      else staleNotes.push(line);
      continue;
    }

    if (overlapsTask(trimmed, keywords)) kept.push(line);
    else removedLines += 1;
  }

  const hasTaskFocus = keywords.length > 0;
  const keptProgressTail = hasTaskFocus ? [] : staleProgress.slice(-1);
  const keptNoteTail = hasTaskFocus ? [] : staleNotes.slice(-1);
  removedLines += Math.max(0, staleProgress.length - keptProgressTail.length);
  removedLines += Math.max(0, staleNotes.length - keptNoteTail.length);

  const merged = [...kept, ...keptProgressTail, ...keptNoteTail]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { content: merged, removedLines };
}

function prepareNotepadContent(session, content, options = {}) {
  const nextContent = typeof content === 'string' ? content : String(content ?? '');
  const currentTask = typeof options.currentTask === 'string'
    ? options.currentTask
    : (session?.mainTask || '');
  const compacted = options.compact === true
    ? compactForCurrentTask(nextContent, currentTask)
    : { content: nextContent, removedLines: 0 };
  const { notepadMaxTokens } = getNotepadBudget(session);
  const trimmed = trimToTokenBudget(compacted.content, notepadMaxTokens);
  return {
    ...trimmed,
    removedLines: compacted.removedLines,
    notepadMaxTokens,
  };
}

function applyNotepadContent(session, content, options = {}) {
  const current = ensureSessionNotepad(session);
  const final = prepareNotepadContent(session, content, options);
  const mainTask = typeof session?.mainTask === 'string' && session.mainTask.trim()
    ? session.mainTask.trim()
    : current.mainTask;
  session.notepad = {
    ...current,
    content: final.content,
    items: parseNotepadItems(final.content),
    lastModified: Date.now(),
    version: (current.version || 0) + 1,
    isBeingEdited: false,
    mainTask: mainTask || null,
  };
  return {
    notepad: session.notepad,
    ...final,
  };
}

function appendNotepadEntry(session, item, category = 'task', options = {}) {
  const current = ensureSessionNotepad(session);
  let content = (current.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (category === 'progress' && content) {
    const target = String(item).trim().toLowerCase();
    const targetWords = target.split(/\s+/).filter(w => w.length > 2);
    const lines = content.split('\n');
    let matchedTask = null;
    for (let index = 0; index < lines.length; index += 1) {
      if (/^-\s*\[\s\]\s+/.test(lines[index])) {
        const taskText = lines[index].replace(/^-\s*\[\s\]\s+/, '').trim().toLowerCase();
        const taskWords = taskText.split(/\s+/).filter(w => w.length > 2);

        // Word-boundary matching: require >50% keyword overlap
        const targetOverlap = targetWords.filter(w => taskText.includes(w)).length / Math.max(targetWords.length, 1);
        const taskOverlap = taskWords.filter(w => target.includes(w)).length / Math.max(taskWords.length, 1);
        const isMatch = targetOverlap > 0.5 || taskOverlap > 0.5;

        if (isMatch) {
          lines[index] = lines[index].replace(/^-\s*\[\s\]/, '- [x]');
          matchedTask = taskText;
          break;
        }
      }
    }
    content = lines.join('\n');
  }

  const prefix = CATEGORY_PREFIX[category] || CATEGORY_PREFIX.task;
  content += (content ? '\n' : '') + `${prefix}${item}`;
  return applyNotepadContent(session, content, options);
}

module.exports = {
  CATEGORY_PREFIX,
  appendNotepadEntry,
  applyNotepadContent,
  canonicalizeSessionNotepadState,
  compactForCurrentTask,
  createDefaultNotepadState,
  ensureSessionNotepad,
  estimateTokens,
  extractDeepTutorNotepadContext,
  extractVisualNotepadContext,
  getNotepadBudget,
  normalizeNotepadState,
  parseNotepadItems,
  prepareNotepadContent,
  trimToTokenBudget,
};
