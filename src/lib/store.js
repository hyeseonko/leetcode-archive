// A two-method view of chrome.storage.local so the rest of the code — and every test —
// never touches a Chrome global directly.
export function createStore(area) {
  return {
    async get(key, fallback = null) {
      const result = await area.get(key);
      return result && key in result ? result[key] : fallback;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}

export function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    async get(key) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(entries) {
      Object.assign(data, entries);
    },
    async remove(key) {
      delete data[key];
    },
  };
}
