const MAX_LIMIT = 500;
const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'exists'];
export function runQuery(data, query) {
    const statuses = new Set(query.status?.length ? query.status : ['confirmed']);
    const types = new Map(data.schema.objectTypes.map(t => [t.apiName, t]));
    const visible = data.objects.filter(o => statuses.has(o.status));
    const byId = new Map(visible.map(o => [o.id, o]));
    const links = data.links.filter(l => statuses.has(l.status) && byId.has(l.fromId) && byId.has(l.toId));
    let currentType = requireType(types, query.objectType);
    let current = visible.filter(o => o.type === currentType);
    if (query.where)
        current = current.filter(compileFilter(query.where, propertiesOf(data.schema, currentType)));
    for (const step of query.traverse ?? []) {
        const forward = data.schema.linkTypes.find(l => l.from === currentType && l.apiName === step.link);
        const backward = data.schema.linkTypes.find(l => l.to === currentType && l.inverseApiName === step.link);
        const def = forward ?? backward;
        if (!def)
            throw new Error(`${currentType} has no link "${step.link}".`);
        const ids = new Set(current.map(o => o.id));
        const next = new Set();
        for (const link of links) {
            if (link.linkType !== def.apiName)
                continue;
            if (forward && ids.has(link.fromId))
                next.add(link.toId);
            if (!forward && ids.has(link.toId))
                next.add(link.fromId);
        }
        currentType = forward ? def.to : def.from;
        current = [...next].map(id => byId.get(id)).filter(o => o.type === currentType);
        if (step.where)
            current = current.filter(compileFilter(step.where, propertiesOf(data.schema, currentType)));
    }
    if (query.aggregate)
        return { objectType: currentType, total: current.length, groups: aggregate(current, query.aggregate, propertiesOf(data.schema, currentType)) };
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 50)), MAX_LIMIT);
    return { objectType: currentType, total: current.length, objects: current.slice(0, limit) };
}
function requireType(types, name) {
    if (!types.has(name))
        throw new Error(`Unknown object type "${name}".`);
    return name;
}
function propertiesOf(schema, type) {
    return new Set(schema.objectTypes.find(t => t.apiName === type)?.properties.map(p => p.apiName));
}
export function compileFilter(filter, props) {
    if (!filter || typeof filter !== 'object')
        throw new Error('Filter must be an object.');
    if ('and' in filter) {
        const parts = filter.and.map(f => compileFilter(f, props));
        return o => parts.every(p => p(o));
    }
    if ('or' in filter) {
        const parts = filter.or.map(f => compileFilter(f, props));
        return o => parts.some(p => p(o));
    }
    if ('not' in filter) {
        const inner = compileFilter(filter.not, props);
        return o => !inner(o);
    }
    const { property, op, value } = filter;
    if (!props.has(property))
        throw new Error(`Unknown property "${property}".`);
    if (!OPS.includes(op))
        throw new Error(`Unknown operator "${op}".`);
    if (op === 'in' && !Array.isArray(value))
        throw new Error('"in" needs an array value.');
    return o => {
        const actual = o.properties[property];
        switch (op) {
            case 'exists': return (actual !== undefined && actual !== null) === (value ?? true);
            case 'eq': return actual === value;
            case 'neq': return actual !== value;
            case 'in': return value.includes(actual);
            case 'contains': return typeof actual === 'string' && typeof value === 'string' && actual.toLowerCase().includes(value.toLowerCase());
            default: {
                if (actual === undefined || actual === null || typeof actual !== typeof value)
                    return false;
                const a = actual;
                const b = value;
                return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
            }
        }
    };
}
function aggregate(objects, spec, props) {
    if (spec.groupBy !== undefined && !props.has(spec.groupBy))
        throw new Error(`Unknown property "${spec.groupBy}".`);
    if (spec.metric !== 'count' && (!spec.property || !props.has(spec.property)))
        throw new Error(`Metric "${spec.metric}" needs a known numeric property.`);
    const groups = new Map();
    for (const o of objects) {
        const key = spec.groupBy === undefined ? null : o.properties[spec.groupBy] ?? null;
        const id = JSON.stringify(key);
        if (!groups.has(id))
            groups.set(id, { key, items: [] });
        groups.get(id).items.push(o);
    }
    return [...groups.values()].map(({ key, items }) => {
        if (spec.metric === 'count')
            return { key, value: items.length };
        const nums = items.map(o => o.properties[spec.property]).filter((v) => typeof v === 'number');
        if (!nums.length)
            return { key, value: null };
        const sum = nums.reduce((a, b) => a + b, 0);
        const value = spec.metric === 'sum' ? sum : spec.metric === 'avg' ? sum / nums.length : spec.metric === 'min' ? Math.min(...nums) : Math.max(...nums);
        return { key, value };
    }).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
}
