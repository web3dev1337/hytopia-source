import PerformanceMonitor from '@/metrics/PerformanceMonitor';

type AnyMethod = (...args: unknown[]) => unknown;
type AnyConstructor = abstract new (...args: unknown[]) => unknown;

export function Monitor(operationName?: string): MethodDecorator {
  return function <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): TypedPropertyDescriptor<T> | void {
    const original = descriptor.value;

    if (typeof original !== 'function') {
      return descriptor;
    }

    const className = (target as { constructor?: { name?: string } }).constructor?.name ?? 'Unknown';
    const name = operationName ?? `${className}.${String(propertyKey)}`;
    const originalFn = original as unknown as AnyMethod;
    const isAsync = originalFn.constructor.name === 'AsyncFunction';

    const wrapped: AnyMethod = function (this: unknown, ...args: unknown[]) {
      if (isAsync) {
        return PerformanceMonitor.instance.measureAsync(
          name,
          () => (originalFn as (...fnArgs: unknown[]) => Promise<unknown>).apply(this, args),
        );
      }

      return PerformanceMonitor.instance.measure(
        name,
        () => originalFn.apply(this, args),
      );
    };

    descriptor.value = wrapped as unknown as T;

    return descriptor;
  };
}

export function MonitorClass(prefix?: string) {
  return function <TConstructor extends AnyConstructor>(constructor: TConstructor): TConstructor {
    const prototype = (constructor as { prototype?: object }).prototype;

    if (!prototype) {
      return constructor;
    }

    const classPrefix = prefix ?? constructor.name;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);

      if (!descriptor) {
        continue;
      }

      const value: unknown = descriptor.value;

      if (typeof value !== 'function') {
        continue;
      }

      const typedDescriptor = descriptor as TypedPropertyDescriptor<unknown>;

      Monitor(`${classPrefix}.${name}`)(prototype, name, typedDescriptor);
      Object.defineProperty(prototype, name, typedDescriptor);
    }

    return constructor;
  };
}

export function monitorBlock<T>(name: string, fn: () => T): T {
  return PerformanceMonitor.instance.measure(name, fn);
}

export async function monitorAsyncBlock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return PerformanceMonitor.instance.measureAsync(name, fn);
}
