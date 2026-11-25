// A host (LiteSpeed or Passenger) may start more than one copy of the server when several requests arrive together. Only one copy
// may hold the students and write them (instance-lock.js). So the first copy also listens on a private door of its own, and every
// other copy only passes its requests through that door: it reads and writes nothing itself. When the first copy is gone, the
// passing copy stops, so the host starts a fresh one that takes its place.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

// A socket file in the data folder (which only this account can open). Windows has no socket files: a named pipe there.
function doorOf(dir) {
  if (process.platform !== 'win32') return path.join(dir, 'primary.sock');
  return '\\\\.\\pipe\\sr360-' + crypto.createHash('sha256').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 24);
}

// The first copy: whatever comes through the door is answered by the same server as everything else. A plain net server, so a
// host that takes over the web server's listen() leaves this one alone.
function openDoor(dir, server) {
  const door = doorOf(dir);
  if (process.platform !== 'win32') { try { fs.unlinkSync(door); } catch (e) { /* none left over */ } }
  const inner = net.createServer((socket) => server.emit('connection', socket));
  inner.on('error', (e) => console.error('[one-writer] the private door did not open:', e.message));
  inner.listen(door, () => { if (process.platform !== 'win32') { try { fs.chmodSync(door, 0o600); } catch (e) { /* the folder is private anyway */ } } });
  inner.unref();
  return inner;
}

// Connects to the first copy, waiting a short while: it may still be starting.
function connect(door, waitMs, pauseMs = 150) {
  const until = Date.now() + waitMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(door);
      const failed = (e) => { socket.destroy(); if (Date.now() < until) setTimeout(attempt, pauseMs); else reject(e); };
      socket.once('error', failed);
      socket.once('connect', () => { socket.removeListener('error', failed); resolve(socket); });
    };
    attempt();
  });
}

// Another copy: a web server that only passes each request on, and the answer back as it comes (live updates included).
function passOn(dir, { waitMs = 8000, gone = () => process.exit(1) } = {}) {
  const door = doorOf(dir);
  return http.createServer(async (req, res) => {
    let socket;
    try { socket = await connect(door, waitMs); } catch (e) {
      console.error('[one-writer] the first copy does not answer, so this one stops:', e.message);
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '2', Connection: 'close' });
      res.end('The system is restarting. Please try again.', () => gone());
      return;
    }
    const headers = { ...req.headers, connection: 'close' };
    if (req.socket.encrypted && !headers['x-forwarded-proto']) headers['x-forwarded-proto'] = 'https';
    const remote = req.socket.remoteAddress;
    if (remote && !headers['x-forwarded-for']) headers['x-forwarded-for'] = remote;
    const out = http.request({ method: req.method, path: req.url, headers, createConnection: () => socket }, (answer) => {
      res.writeHead(answer.statusCode, answer.rawHeaders.reduce((all, value, i, list) => {
        if (i % 2 === 0 && value.toLowerCase() !== 'connection') {
          const key = value.toLowerCase();
          all[key] = key === 'set-cookie' ? [].concat(all[key] || [], list[i + 1]) : list[i + 1];
        }
        return all;
      }, {}));
      answer.pipe(res);
    });
    out.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Please try again.'); } else res.destroy(); });
    res.on('close', () => out.destroy());
    req.pipe(out);
  });
}

module.exports = { doorOf, openDoor, passOn };
