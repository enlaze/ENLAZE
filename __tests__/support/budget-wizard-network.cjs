// Loaded before Next/its workers: refuse outbound sockets before DNS/connect.
// --require preloads CommonJS before Next and every worker opens sockets.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === 'object' ? options.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  const path = typeof options === 'object' ? options.path : typeof options === 'string' ? options : null;
  if (!path && host && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Wizard E2E refused outbound connection to ${host}`);
  }
  return original.apply(this, args);
};
