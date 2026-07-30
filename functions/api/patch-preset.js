// POST /api/patch-preset
// Applies key-value parameter overrides to MilkDrop source code deterministically
export async function onRequest(context) {
    const { request } = context;
    if (request.method === 'OPTIONS') {
        return cors();
    }
    if (request.method !== 'POST') {
        return json({ error: 'Method not allowed. Use POST.' }, 405);
    }
    try {
        const body = (await request.json());
        if (typeof body.milkSource !== 'string') {
            return json({ error: 'milkSource string is required.' }, 400);
        }
        if (!body.patch || typeof body.patch !== 'object') {
            return json({ error: 'patch object is required.' }, 400);
        }
        const patchedSource = applyPresetPatch(body.milkSource, body.patch);
        return json({ milkSource: patchedSource });
    }
    catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Invalid request body.' }, 400);
    }
}
export function applyPresetPatch(source, patch) {
    const remainingPatch = { ...patch };
    const lines = source.split(/\r?\n/u);
    const updatedLines = [];
    for (const line of lines) {
        const trimmed = line.trim();
        const equalsIndex = trimmed.indexOf('=');
        if (equalsIndex > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('[')) {
            const key = trimmed.slice(0, equalsIndex).trim();
            if (key in remainingPatch) {
                const val = remainingPatch[key];
                const formattedVal = typeof val === 'number'
                    ? Number.isInteger(val)
                        ? val.toString()
                        : val.toFixed(6)
                    : String(val);
                updatedLines.push(`${key}=${formattedVal}`);
                delete remainingPatch[key];
                continue;
            }
        }
        updatedLines.push(line);
    }
    // Append remaining new patch keys
    const unappliedKeys = Object.keys(remainingPatch);
    if (unappliedKeys.length > 0) {
        updatedLines.push('');
        updatedLines.push('// Agent Parametric Patch');
        for (const key of unappliedKeys) {
            const val = remainingPatch[key];
            const formattedVal = typeof val === 'number'
                ? Number.isInteger(val)
                    ? val.toString()
                    : val.toFixed(6)
                : String(val);
            updatedLines.push(`${key}=${formattedVal}`);
        }
    }
    return updatedLines.join('\n');
}
function cors() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
