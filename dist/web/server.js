/**
 * HTTP handler for the UI under `/ontology`: the built single-page app plus the
 * read-only JSON API. Every request passes the DSH Connection trust fence
 * (Host/Origin checks and the login cookie) before anything is read.
 */
import { readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, isAbsolute } from 'node:path';
import { ApiError, handleApi } from './api.js';
export const UI_PATH = '/ontology';
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2'
};
const SECURITY_HEADERS = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'"
};
export function createUiHandler({ store, uiDir, reject }) {
    const send = (res, status, type, body, cache = 'no-store') => {
        res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': cache });
        res.end(body);
    };
    const json = (res, status, value) => send(res, status, TYPES['.json'], JSON.stringify(value));
    return async (req, res) => {
        const refused = reject(req);
        if (refused !== undefined) {
            res.statusCode = refused;
            res.end();
            return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' });
            res.end();
            return;
        }
        const url = new URL(req.url ?? '/', 'http://localhost');
        const sub = url.pathname.slice(UI_PATH.length).replace(/^\/+/, '');
        if (sub.startsWith('api/')) {
            try {
                json(res, 200, handleApi(store(), sub.slice(4), url.searchParams));
            }
            catch (error) {
                json(res, error instanceof ApiError ? error.status : 500, { error: error.message });
            }
            return;
        }
        // Static assets; unknown paths fall back to index.html for client-side routes.
        const file = resolve(uiDir, decodeURIComponent(sub) || 'index.html');
        const rel = relative(uiDir, file);
        if (rel.startsWith('..') || isAbsolute(rel)) {
            send(res, 404, 'text/plain', 'Not found');
            return;
        }
        try {
            const body = await readFile(file);
            // Vite puts content hashes in asset names, so those can be cached for good.
            send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', body, rel.startsWith('assets') ? 'public, max-age=31536000, immutable' : 'no-store');
        }
        catch {
            try {
                send(res, 200, TYPES['.html'], await readFile(join(uiDir, 'index.html')));
            }
            catch {
                send(res, 503, 'text/plain; charset=utf-8', 'The ontology UI is not built. Run `pnpm build` in the dsh-ontology-builder checkout.');
            }
        }
    };
}
