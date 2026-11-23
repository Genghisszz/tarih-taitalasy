'use strict';
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const instance = createApp({ dataDir: process.env.DATA_DIR || undefined });

instance.listen(PORT, HOST).then(() => {
  console.log(`Тарих Тайталасы → http://localhost:${PORT}`);
  console.log(`  ойыншылар: http://localhost:${PORT}/`);
  console.log(`  жүргізуші: http://localhost:${PORT}/host`);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await instance.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
