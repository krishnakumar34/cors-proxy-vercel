'use strict';
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs').promises;
const { marked } = require('marked');
const pipe = require('promisepipe');
const access = require('access-control');

const cors = access();

const hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'public',
    'proxy-authenticate',
    'transfer-encoding',
    'upgrade'
]);

module.exports = async (req, res) => {
    if (cors(req, res)) return;

    // 1. Handle Landing Page
    if (req.url === '/' || req.url === '/favicon.ico') {
        try {
            const readmePath = path.join(process.cwd(), 'readme.md');
            const markdownString = await fs.readFile(readmePath, 'utf8');
            const content = marked.parse(markdownString);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).send(content);
        } catch (err) {
            return res.status(500).json({ error: 'Could not load readme.md', details: err.message });
        }
    }

    // 2. Prepare the Proxy Target
    let rawEndpoint = req.url.substring(1);
    
    // Fix: Vercel/Browsers sometimes collapse // into / in the URL path
    if (rawEndpoint.startsWith('http:/') && !rawEndpoint.startsWith('http://')) {
        rawEndpoint = rawEndpoint.replace('http:/', 'http://');
    } else if (rawEndpoint.startsWith('https:/') && !rawEndpoint.startsWith('https://')) {
        rawEndpoint = rawEndpoint.replace('https:/', 'https://');
    }

    try {
        const targetUrl = new URL(rawEndpoint);
        const isHttps = targetUrl.protocol === 'https:';
        const mod = isHttps ? https : http;

        const options = {
            protocol: targetUrl.protocol,
            hostname: targetUrl.hostname,
            port: targetUrl.port || (isHttps ? 443 : 80),
            path: targetUrl.pathname + targetUrl.search,
            method: req.method,
            headers: {
                ...req.headers,
                host: targetUrl.hostname, // Required by most servers (like Google)
            }
        };

        // Remove sensitive or conflicting headers
        delete options.headers['content-length'];
        delete options.headers['connection'];

        // 3. Perform the Proxy Request
        const response = await get(mod, options);

        // Set status and copy headers
        res.statusCode = response.statusCode;
        for (const name of Object.keys(response.headers)) {
            if (hopByHopHeaders.has(name.toLowerCase())) continue;

            const value = response.headers[name];
            const existing = res.getHeader(name);
            if (existing) {
                res.setHeader(name, `${existing}, ${value}`);
            } else {
                res.setHeader(name, value);
            }
        }

        // Handle Redirects (Absolutize the location)
        let location = res.getHeader('location');
        if (location) {
            const locationUrl = new URL(location, targetUrl.href);
            res.setHeader('location', '/' + locationUrl.href);
        }

        await pipe(response, res);

    } catch (err) {
        res.status(500).json({ 
            error: 'Proxy request failed', 
            details: err.message,
            target: rawEndpoint 
        });
    }
};

function get(mod, options) {
    return new Promise((resolve, reject) => {
        mod.request(options, resolve).once('error', reject).end();
    });
}
