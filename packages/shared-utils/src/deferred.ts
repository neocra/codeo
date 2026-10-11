export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;
  settled = false;
  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = (v) => {
        this.settled = true;
        res(v);
      };
      this.reject = (e) => {
        this.settled = true;
        rej(e);
      };
    });
  }
}
