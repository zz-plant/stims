// POST /api/validate-preset
// Dry-run parser and syntax validator for MilkDrop .milk source code
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
        const milkSource = body.milkSource;
        if (typeof milkSource !== 'string') {
            return json({ error: 'milkSource string is required in request body.' }, 400);
        }
        const result = validatePresetSource(milkSource);
        return json(result);
    }
    catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Invalid request body.' }, 400);
    }
}
export function validatePresetSource(source) {
    const diagnostics = [];
    const sections = [];
    let fieldCount = 0;
    let currentSection = null;
    const lines = source.split(/\r?\n/u);
    lines.forEach((line, lineIndex) => {
        const lineNumber = lineIndex + 1;
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }
        // Skip comment lines
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith(';')) {
            return;
        }
        // Section headers e.g. [preset00]
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            currentSection = trimmed.slice(1, -1).trim().toLowerCase();
            if (currentSection && !sections.includes(currentSection)) {
                sections.push(currentSection);
            }
            return;
        }
        const stripComments = (str) => {
            let inQuote = false;
            for (let i = 0; i < str.length; i += 1) {
                if (str[i] === '"' || str[i] === "'") {
                    inQuote = !inQuote;
                }
                else if (!inQuote && str[i] === '/' && str[i + 1] === '/') {
                    return str.slice(0, i).trimEnd();
                }
            }
            return str;
        };
        const cleanLine = stripComments(line).trim();
        if (!cleanLine) {
            return;
        }
        const equalsIndex = cleanLine.indexOf('=');
        if (equalsIndex < 0) {
            if (currentSection === 'warp_shader' || currentSection === 'comp_shader') {
                fieldCount += 1;
                return;
            }
            diagnostics.push({
                severity: 'warning',
                code: 'preset_line_ignored',
                line: lineNumber,
                message: `Line without assignment ignored: "${trimmed.slice(0, 60)}"`,
            });
            return;
        }
        const key = currentSection === 'warp_shader' || currentSection === 'comp_shader'
            ? currentSection
            : cleanLine.slice(0, equalsIndex).trim();
        const rawValue = currentSection === 'warp_shader' || currentSection === 'comp_shader'
            ? cleanLine
            : cleanLine.slice(equalsIndex + 1).trim();
        if (!key) {
            diagnostics.push({
                severity: 'error',
                code: 'preset_missing_key',
                line: lineNumber,
                message: 'Assignment line missing key before "=".',
            });
            return;
        }
        // Unbalanced parentheses check in equation lines
        if (key.includes('init') || key.includes('per_frame') || key.includes('per_pixel')) {
            let openParen = 0;
            for (let i = 0; i < rawValue.length; i += 1) {
                if (rawValue[i] === '(')
                    openParen += 1;
                if (rawValue[i] === ')')
                    openParen -= 1;
                if (openParen < 0) {
                    diagnostics.push({
                        severity: 'error',
                        code: 'unbalanced_parentheses',
                        line: lineNumber,
                        message: `Unbalanced parentheses in equation: "${rawValue.slice(0, 60)}"`,
                    });
                    break;
                }
            }
            if (openParen > 0) {
                diagnostics.push({
                    severity: 'error',
                    code: 'unclosed_parentheses',
                    line: lineNumber,
                    message: `Unclosed parenthesis in equation: "${rawValue.slice(0, 60)}"`,
                });
            }
        }
        fieldCount += 1;
    });
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    return {
        valid: errors.length === 0,
        fieldCount,
        sections,
        errors,
        warnings,
    };
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
