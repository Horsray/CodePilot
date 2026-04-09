const MAX_BUFFER_SIZE = 1000;
const GLOBAL_OUTPUT_BUFFERS_KEY = '__codepilot_terminal_output_buffers__' as const;

function getOutputStore(): Map<string, string[]> {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope[GLOBAL_OUTPUT_BUFFERS_KEY]) {
    globalScope[GLOBAL_OUTPUT_BUFFERS_KEY] = new Map<string, string[]>();
  }
  return globalScope[GLOBAL_OUTPUT_BUFFERS_KEY] as Map<string, string[]>;
}

function getBuffer(id: string): string[] {
  const outputBuffers = getOutputStore();
  let buffer = outputBuffers.get(id);
  if (!buffer) {
    buffer = [];
    outputBuffers.set(id, buffer);
  }
  return buffer;
}

export function resetTerminalOutput(id: string): void {
  getOutputStore().set(id, []);
}

export function appendTerminalOutput(id: string, data: string): void {
  const buffer = getBuffer(id);
  buffer.push(data);
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }
}

export function drainTerminalOutput(id: string): string {
  const outputBuffers = getOutputStore();
  const buffer = outputBuffers.get(id);
  if (!buffer || buffer.length === 0) return '';
  return buffer.splice(0, buffer.length).join('');
}

export function clearTerminalOutput(id: string): void {
  getOutputStore().delete(id);
}
