import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewLoadScheduler } from "./preview-load-scheduler";

describe("PreviewLoadScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs scheduled loads one at a time by default", async () => {
    const scheduler = new PreviewLoadScheduler();
    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = scheduler.schedule(async () => {
      order.push("start:first");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("end:first");
      return "first";
    });
    const second = scheduler.schedule(async () => {
      order.push("start:second");
      return "second";
    });

    await Promise.resolve();
    expect(order).toEqual(["start:first"]);
    expect(scheduler.activeCount).toBe(1);
    expect(scheduler.queuedCount).toBe(1);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(order).toEqual(["start:first", "end:first", "start:second"]);
  });

  it("continues draining after a task fails", async () => {
    const scheduler = new PreviewLoadScheduler();
    const first = scheduler.schedule(async () => {
      throw new Error("load failed");
    });
    const second = scheduler.schedule(async () => "second");

    await expect(first).rejects.toThrow("load failed");
    await expect(second).resolves.toBe("second");
    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.queuedCount).toBe(0);
  });

  it("can leave a short settle window between queued loads", async () => {
    vi.useFakeTimers();
    const scheduler = new PreviewLoadScheduler(1, 50);
    const order: string[] = [];

    const first = scheduler.schedule(async () => {
      order.push("first");
      return "first";
    });
    const second = scheduler.schedule(async () => {
      order.push("second");
      return "second";
    });

    await expect(first).resolves.toBe("first");
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.queuedCount).toBe(1);

    await vi.advanceTimersByTimeAsync(49);
    expect(order).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["first", "second"]);
  });
});
