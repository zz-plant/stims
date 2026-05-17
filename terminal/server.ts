let server: ReturnType<typeof Bun.serve> | null = null;
let latestAnsi = '';
let connections = 0;

export function startServer(port: number, onConnect: () => void) {
  server = Bun.serve({
    port,
    fetch(req, srv) {
      const upgraded = srv.upgrade(req);
      if (upgraded) return;
      return new Response(latestAnsi, {
        headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
      });
    },
    websocket: {
      open() {
        connections += 1;
        onConnect();
        if (connections === 1 && latestAnsi) {
          server?.publish('viz', latestAnsi);
        }
      },
      close() {
        connections -= 1;
      },
      message() {},
    },
  });
}

export function broadcastFrame(ansi: string) {
  latestAnsi = ansi;
  if (connections > 0 && server) {
    server.publish('viz', ansi);
  }
}

export function stopServer() {
  if (server) {
    server.stop(true);
    server = null;
    connections = 0;
  }
}
