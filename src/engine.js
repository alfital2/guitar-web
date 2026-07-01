// src/engine.js
export function buildChain(ctx, chain, registry) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const modules = [];

  let prev = input;
  for (const node of chain) {
    const def = registry[node.type];
    if (!def) throw new Error(`Unknown effect type: ${node.type}`);
    const params = { ...node.params };
    const built = def.create(ctx, params);
    // Bypassed effects are still built (so live param edits apply when re-enabled)
    // but left out of the signal path — the signal flows straight to the next
    // effect, so the rest of the chain keeps working.
    if (!node.bypassed) {
      prev.connect(built.input);
      prev = built.output;
    }
    modules.push({ type: node.type, schema: def.schema, params, apply: built.apply, input: built.input, output: built.output, destroy: built.destroy });
  }
  prev.connect(output);

  function setParam(index, key, value) {
    const m = modules[index];
    m.params[key] = value;
    m.apply(m.params);
  }

  // Tear down every module: stop any LFO/worklet sources it started (so they
  // stop consuming CPU and can be garbage-collected) and disconnect its nodes
  // from the graph. Each module is guarded independently so one bad destroy()
  // doesn't stop the rest of the chain from being cleaned up.
  function destroy() {
    for (const m of modules) {
      try { m.destroy?.(); } catch (e) { console.warn(`[engine] destroy failed for "${m.type}":`, e); }
      try { m.input?.disconnect(); } catch {}
      try { m.output?.disconnect(); } catch {}
    }
  }

  return { input, output, modules, setParam, destroy };
}
