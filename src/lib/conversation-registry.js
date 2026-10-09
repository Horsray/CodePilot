const globalKey = '__activeConversations__';
function getMap() {
    if (!globalThis[globalKey]) {
        globalThis[globalKey] = new Map();
    }
    return globalThis[globalKey];
}
export function registerConversation(sessionId, conversation) {
    getMap().set(sessionId, conversation);
}
export function unregisterConversation(sessionId) {
    getMap().delete(sessionId);
}
export function getConversation(sessionId) {
    return getMap().get(sessionId);
}
