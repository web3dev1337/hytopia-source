import PerformanceMonitor from '@/metrics/PerformanceMonitor';

export function Monitor(operationName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const name = operationName ?? `${className}.${propertyKey}`;

    if (originalMethod.constructor.name === 'AsyncFunction') {
      descriptor.value = async function (...args: any[]) {
        return PerformanceMonitor.instance.measureAsync(
          name,
          () => originalMethod.apply(this, args),
        );
      };
    } else {
      descriptor.value = function (...args: any[]) {
        return PerformanceMonitor.instance.measure(
          name,
          () => originalMethod.apply(this, args),
        );
      };
    }

    return descriptor;
  };
}

export function MonitorClass(prefix?: string) {
  return function <T extends { new(...args: any[]): {} }>(constructor: T) {
    const prototype = constructor.prototype;
    const classPrefix = prefix ?? constructor.name;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);

      if (descriptor && typeof descriptor.value === 'function') {
        Monitor(`${classPrefix}.${name}`)(prototype, name, descriptor);
        Object.defineProperty(prototype, name, descriptor);
      }
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
