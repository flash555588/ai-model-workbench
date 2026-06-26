type ScheduledTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

export class PreviewLoadScheduler {
  private active = 0;
  private readonly queue: ScheduledTask<unknown>[] = [];

  constructor(private readonly maxActive = 1) {}

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  schedule<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.maxActive && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) {
        return;
      }
      this.active += 1;
      Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const inlinePreviewLoadScheduler = new PreviewLoadScheduler(1);

export function scheduleInlinePreviewLoad<T>(run: () => Promise<T>): Promise<T> {
  return inlinePreviewLoadScheduler.schedule(run);
}
