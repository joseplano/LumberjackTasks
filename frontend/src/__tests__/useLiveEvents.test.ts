import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveEvents } from '@/lib/useLiveEvents';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe('useLiveEvents', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    window.localStorage.setItem('token', 'test-token');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('opens a stream with token and projectId, debounces bursts, closes on unmount', () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useLiveEvents('p1', onEvent));

    expect(MockEventSource.instances).toHaveLength(1);
    const source = MockEventSource.instances[0];
    expect(source.url).toContain('token=test-token');
    expect(source.url).toContain('projectId=p1');

    act(() => {
      source.onmessage!({ data: JSON.stringify({ type: 'ticket.created', projectId: 'p1' }) });
      source.onmessage!({ data: JSON.stringify({ type: 'ticket.moved', projectId: 'p1' }) });
      vi.advanceTimersByTime(250);
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'ticket.moved', projectId: 'p1' });

    unmount();
    expect(source.closed).toBe(true);
  });

  it('omits projectId for global subscriptions and ignores malformed payloads', () => {
    const onEvent = vi.fn();
    renderHook(() => useLiveEvents(null, onEvent));

    const source = MockEventSource.instances[0];
    expect(source.url).not.toContain('projectId');

    act(() => {
      source.onmessage!({ data: 'not-json' });
      vi.advanceTimersByTime(250);
    });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('does not connect without a token', () => {
    window.localStorage.clear();
    renderHook(() => useLiveEvents('p1', vi.fn()));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('closes the old stream and opens a new one when projectId changes', () => {
    const { rerender } = renderHook(
      ({ pid }: { pid: string }) => useLiveEvents(pid, vi.fn()),
      { initialProps: { pid: 'p1' } },
    );
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('projectId=p1');

    rerender({ pid: 'p2' });
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[0].closed).toBe(true);
    expect(MockEventSource.instances[1].closed).toBe(false);
    expect(MockEventSource.instances[1].url).toContain('projectId=p2');
  });
});
