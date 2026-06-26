import { describe, expect, it } from "vitest";
import {
  createPreviewDisassemblyController,
  type PreviewDisassemblyAdapter,
  type PreviewDisassemblySubscriptions,
} from "./disassembly";

interface TestPart {
  id: number;
  position: number;
  disposed?: boolean;
}

interface TestTransform {
  position: number;
}

interface TestDrag {
  part: TestPart;
  startPosition: number;
}

function pointerEvent(partial: Partial<PointerEvent>): PointerEvent {
  return {
    button: 0,
    buttons: 1,
    clientX: 0,
    clientY: 0,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
    ...partial,
  } as PointerEvent;
}

function createTestAdapter(parts: TestPart[]) {
  let subscriptions: PreviewDisassemblySubscriptions | null = null;
  const captureCalls: number[] = [];
  const restoreCalls: number[] = [];
  const adapter: PreviewDisassemblyAdapter<TestPart, TestTransform, TestDrag> = {
    getParts: () => parts,
    getPartId: (part) => part.id,
    isDisposed: (part) => !!part.disposed,
    captureTransform: (part) => {
      captureCalls.push(part.id);
      return { position: part.position };
    },
    restoreTransform: (part, transform) => {
      restoreCalls.push(part.id);
      part.position = transform.position;
    },
    subscribe: (nextSubscriptions) => {
      subscriptions = nextSubscriptions;
      return () => {
        subscriptions = null;
      };
    },
    resolvePart: (target) => target as TestPart | null,
    setSelected: () => undefined,
    beginDrag: (part) => ({ part, startPosition: part.position }),
    updateDrag: (drag, event) => {
      drag.part.position = drag.startPosition + event.clientX;
    },
    endDrag: () => undefined,
    updateSelectionOcclusion: () => undefined,
  };
  return {
    adapter,
    captureCalls,
    restoreCalls,
    getSubscriptions: () => subscriptions,
  };
}

describe("preview disassembly controller", () => {
  it("captures original transforms lazily when a part is actually dragged", () => {
    const parts = [
      { id: 1, position: 10 },
      { id: 2, position: 20 },
      { id: 3, position: 30 },
    ];
    const { adapter, captureCalls, restoreCalls, getSubscriptions } = createTestAdapter(parts);
    const controller = createPreviewDisassemblyController(adapter);

    expect(captureCalls).toEqual([]);

    controller.setEnabled(true);
    const subscriptions = getSubscriptions();
    expect(subscriptions).not.toBeNull();

    subscriptions?.onPointerDown(parts[1], pointerEvent({ clientX: 0, clientY: 0 }));
    expect(captureCalls).toEqual([]);

    subscriptions?.onPointerMove(pointerEvent({ clientX: 8, clientY: 0 }));

    expect(captureCalls).toEqual([2]);
    expect(parts[1].position).toBe(28);

    subscriptions?.onPointerUp(pointerEvent({ clientX: 8, clientY: 0 }));
    controller.reset();

    expect(restoreCalls).toEqual([2]);
    expect(parts.map((part) => part.position)).toEqual([10, 20, 30]);
  });

  it("does not capture or restore transforms for click-only selection", () => {
    const parts = [{ id: 1, position: 10 }];
    const { adapter, captureCalls, restoreCalls, getSubscriptions } = createTestAdapter(parts);
    const controller = createPreviewDisassemblyController(adapter);

    controller.setEnabled(true);
    const subscriptions = getSubscriptions();
    subscriptions?.onPointerDown(parts[0], pointerEvent({ clientX: 0, clientY: 0 }));
    subscriptions?.onPointerMove(pointerEvent({ clientX: 2, clientY: 0 }));
    subscriptions?.onPointerUp(pointerEvent({ clientX: 2, clientY: 0 }));
    controller.reset();

    expect(captureCalls).toEqual([]);
    expect(restoreCalls).toEqual([]);
    expect(parts[0].position).toBe(10);
  });
});
