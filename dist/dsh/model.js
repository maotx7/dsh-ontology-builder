/**
 * Prior attempts are replayed as user turns rather than synthetic assistant
 * and tool messages: one-shot requests may only carry identity-free user input.
 */
export function createModel(llm, select, maxTokens) {
    const fn = (async ({ system, turns, tool, signal }) => {
        const { provider, model, reasoningEffort } = select();
        const text = turns.map(t => (t.role === 'assistant' ? `Your previous answer was:\n${t.text}` : t.text)).join('\n\n');
        let reply = '';
        const calls = new Map();
        for await (const chunk of llm.stream({
            provider, model, ...(reasoningEffort ? { reasoningEffort } : {}),
            system, messages: [{ role: 'user', content: [{ type: 'text', text }] }],
            tools: [tool], temperature: 0, maxTokens, signal
        })) {
            if (chunk.type === 'text-delta')
                reply += chunk.text;
            else if (chunk.type === 'tool-call-delta') {
                const c = chunk;
                const entry = calls.get(c.index) ?? { args: '' };
                if (c.name)
                    entry.name = c.name;
                entry.args += c.argumentsDelta;
                calls.set(c.index, entry);
            }
            else if (chunk.type === 'block-end') {
                const b = chunk;
                if (b.block.type === 'tool-call')
                    calls.set(b.index, { name: b.block.name, args: b.block.arguments ?? '' });
            }
            else if (chunk.type === 'finish') {
                const reason = chunk.reason;
                if (reason.kind === 'error' || reason.kind === 'aborted')
                    throw new Error(`Model call failed: ${reason.failure?.message ?? reason.kind}`);
            }
        }
        const call = [...calls.values()].find(c => c.name === tool.name);
        if (!call)
            return { text: reply };
        try {
            return { call: JSON.parse(call.args || '{}'), text: reply };
        }
        catch {
            return { text: `${reply}\n(submit_extraction arguments were not valid JSON: ${call.args.slice(0, 200)})` };
        }
    });
    fn.selection = select;
    return fn;
}
