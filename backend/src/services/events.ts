import { EventEmitter } from 'node:events';

export interface AppEvent {
  type: string;
  projectId: string | null;
  entityId?: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open SSE connection

export function publishEvent(event: AppEvent) {
  bus.emit('event', event);
}

export function subscribeEvents(listener: (event: AppEvent) => void): () => void {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
