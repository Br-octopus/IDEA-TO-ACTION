(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ForwardStepWorkbenchLayout = api;
})(typeof globalThis === "undefined" ? this : globalThis, function() {
  const GAP = 8;
  const CHAT_MIN = 360;
  const PREVIEW_MIN = 320;
  const SNAP = 32;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function resolveLayout(saved, width) {
    const canSplit = width >= CHAT_MIN + PREVIEW_MIN + GAP;
    const mode = saved.mode === "split" && !canSplit ? saved.lastSide : saved.mode;
    const available = Math.max(0, width - GAP);
    return {
      mode,
      canSplit,
      chatWidth: canSplit ? clamp(available * saved.ratio, CHAT_MIN, available - PREVIEW_MIN) : width
    };
  }

  function dragLayout(initial, rawX, width, moved) {
    if (!moved || width < CHAT_MIN + PREVIEW_MIN + GAP) return { ...initial };
    if (initial.mode !== "split" && (rawX <= SNAP || rawX >= width - SNAP)) return { ...initial };
    if (rawX <= SNAP) return { ...initial, mode: "preview", lastSide: "preview" };
    if (rawX >= width - SNAP) return { ...initial, mode: "chat", lastSide: "chat" };
    const available = width - GAP;
    return { ...initial, mode: "split", ratio: clamp(rawX, CHAT_MIN, available - PREVIEW_MIN) / available };
  }

  return { resolveLayout, dragLayout };
});
