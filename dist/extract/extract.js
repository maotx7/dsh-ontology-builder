/**
 * Schema-guided extraction from document chunks. The model answers through a
 * `submit_extraction` tool call; output is validated (shape, schema, verbatim
 * quotes) and sent back with the errors for a bounded number of retries.
 * Nothing here writes to the store: the caller records the result as candidates.
 */
import { findQuote } from '../core/evidence.js';
import { validateProperties } from '../core/schema.js';
export const PROMPT_VERSION = 'extract-v1';
const ROLES = ['specified', 'observed', 'correspondence', 'inferred'];
export const SUBMIT_TOOL = {
    name: 'submit_extraction',
    description: 'Submit every object and link found in the text. Submit empty lists if there are none.',
    parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['objects', 'links'],
        properties: {
            objects: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: false, required: ['type', 'properties', 'quote'],
                    properties: {
                        type: { type: 'string', description: 'Object type apiName.' },
                        properties: { type: 'object', description: 'Values keyed by property apiName; include the primary key.' },
                        quote: { type: 'string', description: 'Exact text from the passage that states this object. Copy it character for character.' },
                        role: { type: 'string', enum: ROLES },
                        fieldQuotes: { type: 'object', description: 'Optional: property apiName -> exact text supporting that value.' }
                    }
                }
            },
            links: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: false, required: ['linkType', 'from', 'to', 'quote'],
                    properties: {
                        linkType: { type: 'string' },
                        from: { type: 'object', required: ['type', 'key'], properties: { type: { type: 'string' }, key: { description: 'Primary key value.' } } },
                        to: { type: 'object', required: ['type', 'key'], properties: { type: { type: 'string' }, key: { description: 'Primary key value.' } } },
                        quote: { type: 'string', description: 'Exact text from the passage that states this relationship.' },
                        role: { type: 'string', enum: ROLES }
                    }
                }
            }
        }
    }
};
export function systemPrompt(schema, instructions) {
    const types = schema.objectTypes.map(t => {
        const props = t.properties.map(p => `    - ${p.apiName}: ${p.type}${p.apiName === t.primaryKey ? ' (primary key)' : ''}${p.required ? ' (required)' : ''}${p.enum ? ` one of ${p.enum.join(' | ')}` : ''}${p.description ? ` — ${p.description}` : ''}`).join('\n');
        return `- ${t.apiName}${t.description ? `: ${t.description}` : ''}\n${props}`;
    }).join('\n');
    const links = schema.linkTypes.map(l => `- ${l.apiName}: ${l.from} → ${l.to} (${l.cardinality})${l.description ? ` — ${l.description}` : ''}`).join('\n') || '(none)';
    return [
        'You extract instances of an ontology from a passage of a source document.',
        'Rules:',
        '1. Only extract what the passage itself states. Do not use outside knowledge.',
        '2. Every object and link needs `quote`: text copied exactly from the passage (same characters, no paraphrase, no ellipsis). Keep quotes short — one sentence or less.',
        '3. Use only the object types, properties and link types below. Use the exact apiNames. Omit properties the passage does not state.',
        '4. Use the same primary key value for the same thing every time, written as in the passage.',
        '5. role: "specified" when the passage states it directly; "inferred" when you concluded it from context. Prefer leaving an item out over guessing.',
        '6. A link may only refer to objects you also submit, or that the passage clearly names.',
        '7. Answer only by calling submit_extraction.',
        instructions ? `\nProject guidance:\n${instructions}` : '',
        `\nObject types:\n${types}`,
        `\nLink types:\n${links}`
    ].join('\n');
}
function userPrompt(chunk, materialName) {
    return `Passage from "${materialName}" (characters ${chunk.start}–${chunk.end}):\n<passage>\n${chunk.text}\n</passage>`;
}
/** Check one submission; returns usable items plus problems the model should fix. */
export function checkSubmission(schema, chunk, materialId, raw) {
    const problems = [];
    const objects = [];
    const links = [];
    if (!raw || typeof raw !== 'object')
        return { objects, links, problems: ['Arguments must be an object with `objects` and `links`.'] };
    const value = raw;
    const types = new Map(schema.objectTypes.map(t => [t.apiName, t]));
    const linkTypes = new Map(schema.linkTypes.map(l => [l.apiName, l]));
    const quoteOk = (quote, where) => {
        if (typeof quote !== 'string' || !quote.trim()) {
            problems.push(`${where}: quote is missing.`);
            return false;
        }
        if (!findQuote(chunk.text, quote)) {
            problems.push(`${where}: quote ${JSON.stringify(quote.slice(0, 80))} is not in the passage. Copy it exactly or drop the item.`);
            return false;
        }
        return true;
    };
    const role = (r) => (ROLES.includes(r) ? r : 'specified');
    const evidence = (quote, r, field) => ({ materialId, quote, role: r, near: chunk.start, ...(field ? { field } : {}) });
    const submitted = new Set();
    (Array.isArray(value.objects) ? value.objects : []).forEach((item, i) => {
        const where = `objects[${i}]`;
        const type = types.get(item?.type);
        if (!type)
            return problems.push(`${where}: unknown type ${JSON.stringify(item?.type)}.`);
        const properties = item.properties && typeof item.properties === 'object' && !Array.isArray(item.properties) ? item.properties : {};
        const errors = validateProperties(type, properties).filter(p => p.severity === 'blocking');
        if (errors.length)
            return problems.push(`${where} (${type.apiName}): ${errors.map(e => e.message).join(' ')}`);
        if (!quoteOk(item.quote, where))
            return;
        const ev = [evidence(item.quote, role(item.role))];
        if (item.fieldQuotes && typeof item.fieldQuotes === 'object') {
            for (const [field, quote] of Object.entries(item.fieldQuotes)) {
                if (type.properties.some(p => p.apiName === field) && typeof quote === 'string' && findQuote(chunk.text, quote))
                    ev.push(evidence(quote, role(item.role), field));
            }
        }
        submitted.add(`${type.apiName}\u0000${properties[type.primaryKey]}`);
        objects.push({ type: type.apiName, properties, evidence: ev });
    });
    (Array.isArray(value.links) ? value.links : []).forEach((item, i) => {
        const where = `links[${i}]`;
        const def = linkTypes.get(item?.linkType);
        if (!def)
            return problems.push(`${where}: unknown link type ${JSON.stringify(item?.linkType)}.`);
        if (item.from?.type !== def.from || item.to?.type !== def.to)
            return problems.push(`${where}: ${def.apiName} goes from ${def.from} to ${def.to}.`);
        if (item.from.key === undefined || item.to.key === undefined)
            return problems.push(`${where}: from.key and to.key are required.`);
        if (!quoteOk(item.quote, where))
            return;
        links.push({ linkType: def.apiName, from: { type: def.from, key: item.from.key }, to: { type: def.to, key: item.to.key }, evidence: [evidence(item.quote, role(item.role))] });
    });
    return { objects, links, problems };
}
/** Extract from one chunk, retrying with the validation errors until clean or out of attempts. */
export async function extractChunk(opts) {
    const system = systemPrompt(opts.schema, opts.instructions);
    const turns = [{ role: 'user', text: userPrompt(opts.chunk, opts.materialName) }];
    let best = { objects: [], links: [], problems: ['The model did not call submit_extraction.'] };
    let output = null;
    let attempts = 0;
    while (attempts < opts.maxAttempts) {
        attempts++;
        opts.signal?.throwIfAborted();
        const reply = await opts.model({ system, turns, tool: SUBMIT_TOOL, signal: opts.signal });
        output = reply.call ?? reply.text;
        const checked = reply.call === undefined ? { objects: [], links: [], problems: ['Answer by calling submit_extraction, not with text.'] } : checkSubmission(opts.schema, opts.chunk, opts.materialId, reply.call);
        // Keep the attempt that produced the most usable items.
        if (attempts === 1 || checked.objects.length + checked.links.length >= best.objects.length + best.links.length)
            best = checked;
        if (!checked.problems.length)
            break;
        turns.push({ role: 'assistant', text: reply.call === undefined ? reply.text : `submit_extraction(${JSON.stringify(reply.call)})` });
        turns.push({ role: 'user', text: `Your submission had problems:\n- ${checked.problems.join('\n- ')}\nCall submit_extraction again with the full corrected list. Items you cannot support with an exact quote should be left out.` });
    }
    return { chunk: opts.chunk, objects: best.objects, links: best.links, attempts, problems: best.problems, output };
}
