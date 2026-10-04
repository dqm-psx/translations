const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

// Serve exactly the public files under the GitHub Pages project prefix.
const publicFiles = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['index.html', ['index.html', 'text/html; charset=utf-8']],
  ['comparison-data.json', ['comparison-data.json', 'application/json; charset=utf-8']],
  ['coverage-report.json', ['coverage-report.json', 'application/json; charset=utf-8']],
  ['DQM-translation-comparison.md', ['DQM-translation-comparison.md', 'text/plain; charset=utf-8']],
]);

async function startServer(root) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const entry = pathname.startsWith('/translations/') && publicFiles.get(pathname.slice('/translations/'.length));
    if (!entry) {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      const bytes = await readFile(path.join(root, entry[0]));
      response.writeHead(200, { 'Content-Type': entry[1], 'Content-Length': bytes.length });
      response.end(bytes);
    } catch (error) {
      response.writeHead(500).end(error.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/translations/`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

module.exports = { startServer };
