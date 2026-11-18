// Missing or wrong-shaped API fields. Arrays count as objects, matching the checks these replaced.
export const asList = v => Array.isArray(v) ? v : [];
export const asObj = v => v && typeof v === 'object' ? v : null;
