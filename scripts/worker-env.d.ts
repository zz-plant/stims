interface WebSocket {
  accept(): void;
}

interface ResponseInit {
  webSocket?: WebSocket;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
