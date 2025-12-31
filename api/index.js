'use strict';
const http = require('http');
const https = require('https');
const { parse, format } = require('url');
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
    // Handle CORS preflight and headers
    if (cors(req, res)) return;

    if (req.url === '/' || req.url === '/favicon.ico') {
        try {
            // Use process.cwd() to reliably find the file in Vercel's environment
            const readmePath = path.join(process.cwd(), 'readme.md');
            const markdownString = await fs.readFile(readmePath, 'utf8');
            
            // marked is now synchronous or returns a promise depending on version; 
            // this syntax works for the latest versions.
            const content = marked.parse(markdownString);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.status(200).send(content);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Yikes! Help me at @gnumanth' });
        }
    } else {
        // proxy and respond
        const endpoint = req.url.substring(1);
        const parsed = parse(endpoint);
        
        let mod;
        if (parsed.protocol === 'http:') {
            mod = http;
        } else if (parsed.protocol === 'https:') {
            mod = https;
        } else {
            return res.status(400).json({ error: 'Only absolute URLs are supported' });
        }

        parsed.headers = Object.assign({}, req.headers, {
            host: parsed.hostname
        });

        try {
            const response = await get(mod, parsed);

            // Set status code
            res.statusCode = response.statusCode;

            // Copy headers from target to response
            for (const name of Object.keys(response.headers)) {
                if (hopByHopHeaders.has(name.toLowerCase())) continue;

                let value = response.headers[name];
                // Append if header already exists (like Vary)
                const existing = res.getHeader(name);
                if (existing) {
                    res.setHeader(name, `${existing}, ${value}`);
                } else {
                    res.setHeader(name, value);
                }
            }

            // Handle Redirects: update Location header to point back to this proxy
            let location = res.getHeader('location');
            if (location) {
                const locationParsed = parse(location);
                if (!locationParsed.protocol) {
                    location = format(Object.assign({}, parsed, {
                        path: null,
                        pathname: location
                    }));
                }
                res.setHeader('location', '/' + location);
            }

            await pipe(response, res);
        } catch (err) {
            res.status(500).json({ error: 'Proxy request failed', details: err.message });
        }
    }
};

function get(mod, parsed) {
    return new Promise((resolve, reject) => {
        mod.get(parsed, resolve).once('error', reject);
    });
                                           }
