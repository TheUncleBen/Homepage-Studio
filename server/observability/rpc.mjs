// Request/response messages between the controller and its worker threads.
// Each side answers the other side's calls by method name.

export function createPort(port, handlers = {}) {
  let next = 1;
  const pending = new Map();
  port.on('message', async message => {
    if (!message || typeof message !== 'object') return;
    if (message.reply) {
      const waiting = pending.get(message.reply);
      if (!waiting) return;
      pending.delete(message.reply);
      clearTimeout(waiting.timer);
      if (message.error) waiting.reject(Object.assign(new Error(message.error.message), { code: message.error.code, status: message.error.status }));
      else waiting.resolve(message.result);
      return;
    }
    if (message.cast) { try { await handlers[message.cast]?.(message.params); } catch {} return; }
    if (!message.call) return;
    try {
      const handler = handlers[message.call];
      if (!handler) throw Object.assign(new Error('Unknown call'), { code: 'UNKNOWN_CALL' });
      port.postMessage({ reply: message.id, result: await handler(message.params) });
    } catch (error) {
      port.postMessage({ reply: message.id, error: { message: error.message, code: error.code, status: error.status } });
    }
  });
  return {
    call(method, params, timeoutMs = 15000) {
      const id = next++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Object.assign(new Error('The monitoring engine did not answer in time.'), { code: 'OBSERVABILITY_TIMEOUT', status: 503 })); }, timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        port.postMessage({ call: method, id, params });
      });
    },
    // Fire and forget.
    cast(method, params) { port.postMessage({ cast: method, params }); },
    // Rejects everything still waiting (the other side went away).
    abort(code = 'OBSERVABILITY_UNAVAILABLE') {
      for (const [id, waiting] of pending) { clearTimeout(waiting.timer); waiting.reject(Object.assign(new Error('Monitoring and logs are restarting. Try again in a moment.'), { code, status: 503 })); pending.delete(id); }
    },
  };
}
