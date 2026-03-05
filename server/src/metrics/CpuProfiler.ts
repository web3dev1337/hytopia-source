import { writeFileSync } from 'fs';

let inspectorModule: typeof import('node:inspector') | null = null;

async function getInspector(): Promise<typeof import('node:inspector') | null> {
  if (inspectorModule) return inspectorModule;

  try {
    inspectorModule = await import('node:inspector');

    return inspectorModule;
  } catch {
    return null;
  }
}

export default class CpuProfiler {
  public static async captureProfile(durationMs: number, outputPath?: string): Promise<object | null> {
    const inspector = await getInspector();

    if (!inspector) {
      console.warn('CpuProfiler: node:inspector not available in this runtime');

      return null;
    }

    const session = new inspector.Session();

    session.connect();

    return new Promise((resolve, reject) => {
      session.post('Profiler.enable', () => {
        session.post('Profiler.start', () => {
          setTimeout(() => {
            session.post('Profiler.stop', (err, { profile }) => {
              session.post('Profiler.disable');
              session.disconnect();

              if (err) {
                reject(err);

                return;
              }

              if (outputPath) {
                writeFileSync(outputPath, JSON.stringify(profile));
              }

              resolve(profile);
            });
          }, durationMs);
        });
      });
    });
  }

  public static async captureHeapSnapshot(outputPath?: string): Promise<string> {
    const inspector = await getInspector();

    if (!inspector) {
      console.warn('CpuProfiler: node:inspector not available in this runtime');

      return '';
    }

    const session = new inspector.Session();

    session.connect();

    let chunks = '';

    session.on('HeapProfiler.addHeapSnapshotChunk', (m: any) => {
      chunks += m.params.chunk;
    });

    return new Promise((resolve, reject) => {
      session.post('HeapProfiler.takeHeapSnapshot', undefined, (err: Error | null) => {
        session.disconnect();

        if (err) {
          reject(err);

          return;
        }

        if (outputPath) {
          writeFileSync(outputPath, chunks);
        }

        resolve(chunks);
      });
    });
  }
}
