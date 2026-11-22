import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Только для разработки: принимает экспорт сцены из браузера (POST /__save?name=...) и пишет в work/exports.
// Нужен, чтобы отрендерить панорамы в Blender из той же модели стадиона, что видит пользователь.
function saveExport() {
  return {
    name: 'save-export',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (request, response) => {
        if (request.method !== 'POST') { response.statusCode = 405; response.end(); return; }
        const name = new URL(request.url, 'http://localhost').searchParams.get('name') || 'export.bin';
        if (!/^[\w.-]+$/.test(name)) { response.statusCode = 400; response.end('bad name'); return; }
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          const target = resolve(import.meta.dirname, '../../work/exports', name);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, Buffer.concat(chunks));
          response.end(String(Buffer.concat(chunks).length));
        });
      });
    },
  };
}

export default defineConfig({ base: './', plugins: [saveExport()] });
