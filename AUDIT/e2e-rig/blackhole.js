// Accepts TCP connections on the storage port and never answers — what a
// stalled mobile upload looks like to the app. Used to prove upload hangs.
const net = require('net');
const port = Number(process.argv[2] ?? 4568);
const sockets = new Set();
net
  .createServer((s) => {
    sockets.add(s);
    s.on('data', () => {}); // swallow the request body, never reply
    s.on('close', () => sockets.delete(s));
    s.on('error', () => {});
  })
  .listen(port, '0.0.0.0', () => console.log(`black hole listening on ${port}`));
