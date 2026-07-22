const MODULE_ID = /^[a-z0-9][a-z0-9-]*$/;

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function normalizePlaceSourceModules(value, label = 'place source modules') {
  invariant(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`);
  const normalized = value.map((moduleId) => {
    invariant(
      typeof moduleId === 'string' && MODULE_ID.test(moduleId),
      `${label} contains an unsafe module ID`,
    );
    return moduleId;
  });
  invariant(new Set(normalized).size === normalized.length, `${label} contains a duplicate module ID`);
  return Object.freeze([...normalized].sort());
}
