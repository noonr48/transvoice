function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonCompatible(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : '';
}

function normalizeInteger(value) {
  if (value == null || value === '') {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.floor(numericValue))
    : null;
}

function normalizeBoolean(value) {
  return typeof value === 'boolean'
    ? value
    : null;
}

function normalizeRecordSlice(value) {
  return isRecord(value) ? value : null;
}

function hasMeaningfulValue(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
}

function nullableSchema(schema) {
  return {
    anyOf: [
      schema,
      { type: 'null' },
    ],
  };
}

function anyObjectSchema() {
  return {
    type: 'object',
    additionalProperties: true,
  };
}

function anyArraySchema(itemSchema = {}) {
  return {
    type: 'array',
    items: itemSchema,
  };
}

module.exports = {
  anyArraySchema,
  anyObjectSchema,
  cloneJsonCompatible,
  hasMeaningfulValue,
  isRecord,
  normalizeBoolean,
  normalizeInteger,
  normalizeRecordSlice,
  normalizeText,
  nullableSchema,
};
