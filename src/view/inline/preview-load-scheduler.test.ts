import { describe, expect, it } from "vitest";
import { PreviewLoadScheduler } from "./preview-load-scheduler";

describe("PreviewLoadScheduler", () => {
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
});
