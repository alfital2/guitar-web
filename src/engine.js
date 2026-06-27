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
    prev.connect(built.input);
    prev = built.output;
    modules.push({ type: node.type, schema: def.schema, params, apply: built.apply, input: built.input, output: built.output });
  }
  prev.connect(output);

  function setParam(index, key, value) {
    const m = modules[index];
    m.params[key] = value;
    m.apply(m.params);
  }

  return { input, output, modules, setParam };
}
