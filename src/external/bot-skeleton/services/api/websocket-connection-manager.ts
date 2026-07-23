// @ts-nocheck
let _instance = null;

class WebSocketConnectionManager {
    constructor() { this.ws = null; }
    static getInstance() { if (!_instance) _instance = new WebSocketConnectionManager(); return _instance; }
    connect() {}
    disconnect() {}
    onMessage() {}
    onStatusChange() {}
}

export { WebSocketConnectionManager };
export default WebSocketConnectionManager;
