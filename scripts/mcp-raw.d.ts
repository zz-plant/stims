declare module '*?raw' {
  const content: string;
  export default content;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
  constructor();
}
