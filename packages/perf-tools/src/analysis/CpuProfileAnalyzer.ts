export interface ProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount: number;
  children?: number[];
  selfTimeMs: number;
  totalTimeMs: number;
}

export interface HotFunction {
  name: string;
  url: string;
  line: number;
  selfTimeMs: number;
  totalTimeMs: number;
  selfPct: number;
  isWasm: boolean;
  wasmModule?: string;
}

export interface CallTreeNode {
  name: string;
  selfTimeMs: number;
  totalTimeMs: number;
  children: CallTreeNode[];
}

export interface CpuProfileAnalysis {
  totalDurationMs: number;
  hotFunctions: HotFunction[];
  callTree: CallTreeNode;
  wasmFunctions: HotFunction[];
  topScripts: { url: string; selfTimeMs: number; pct: number }[];
}

interface RawProfile {
  nodes: {
    id: number;
    callFrame: {
      functionName: string;
      scriptId: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
    hitCount: number;
    children?: number[];
  }[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

export default class CpuProfileAnalyzer {
  private _wasmNameMap: Map<string, string> = new Map();

  public setWasmNameMap(map: Map<string, string>): void {
    this._wasmNameMap = map;
  }

  public analyze(profile: RawProfile): CpuProfileAnalysis {
    const totalDurationMs = (profile.endTime - profile.startTime) / 1000;
    const nodeMap = new Map<number, ProfileNode>();

    for (const node of profile.nodes) {
      nodeMap.set(node.id, {
        ...node,
        selfTimeMs: 0,
        totalTimeMs: 0,
      });
    }

    const sampleTimeUs = profile.timeDeltas;

    for (let i = 0; i < profile.samples.length; i++) {
      const nodeId = profile.samples[i];
      const timeMs = (sampleTimeUs[i] ?? 0) / 1000;
      const node = nodeMap.get(nodeId);

      if (node) {
        node.selfTimeMs += timeMs;
      }
    }

    this._computeTotalTimes(nodeMap, profile.nodes[0]?.id ?? 1);

    const allNodes = Array.from(nodeMap.values());
    const hotFunctions = this._buildHotFunctions(allNodes, totalDurationMs);
    const wasmFunctions = hotFunctions.filter(f => f.isWasm);
    const callTree = this._buildCallTree(nodeMap, profile.nodes[0]?.id ?? 1);
    const topScripts = this._buildTopScripts(allNodes, totalDurationMs);

    return {
      totalDurationMs,
      hotFunctions: hotFunctions.slice(0, 50),
      callTree,
      wasmFunctions,
      topScripts,
    };
  }

  private _computeTotalTimes(nodeMap: Map<number, ProfileNode>, rootId: number): void {
    const visited = new Set<number>();

    const dfs = (id: number): number => {
      if (visited.has(id)) return 0;

      visited.add(id);

      const node = nodeMap.get(id);

      if (!node) return 0;

      let total = node.selfTimeMs;

      if (node.children) {
        for (const childId of node.children) {
          total += dfs(childId);
        }
      }

      node.totalTimeMs = total;

      return total;
    };

    dfs(rootId);
  }

  private _buildHotFunctions(nodes: ProfileNode[], totalMs: number): HotFunction[] {
    return nodes
      .filter(n => n.selfTimeMs > 0 && n.callFrame.functionName !== '(idle)')
      .map(n => {
        const isWasm = n.callFrame.url.includes('wasm') || n.callFrame.functionName.startsWith('wasm-');
        const wasmName = isWasm ? this._wasmNameMap.get(n.callFrame.functionName) : undefined;

        return {
          name: wasmName ?? n.callFrame.functionName,
          url: n.callFrame.url,
          line: n.callFrame.lineNumber,
          selfTimeMs: n.selfTimeMs,
          totalTimeMs: n.totalTimeMs,
          selfPct: totalMs > 0 ? (n.selfTimeMs / totalMs) * 100 : 0,
          isWasm,
          wasmModule: wasmName ? 'rapier3d' : undefined,
        };
      })
      .sort((a, b) => b.selfTimeMs - a.selfTimeMs);
  }

  private _buildCallTree(nodeMap: Map<number, ProfileNode>, rootId: number): CallTreeNode {
    const build = (id: number, depth: number): CallTreeNode => {
      const node = nodeMap.get(id);

      if (!node || depth > 20) {
        return { name: '(unknown)', selfTimeMs: 0, totalTimeMs: 0, children: [] };
      }

      const children: CallTreeNode[] = [];

      if (node.children) {
        for (const childId of node.children) {
          const child = nodeMap.get(childId);

          if (child && child.totalTimeMs > 0) {
            children.push(build(childId, depth + 1));
          }
        }
      }

      children.sort((a, b) => b.totalTimeMs - a.totalTimeMs);

      return {
        name: node.callFrame.functionName || '(anonymous)',
        selfTimeMs: node.selfTimeMs,
        totalTimeMs: node.totalTimeMs,
        children: children.slice(0, 10),
      };
    };

    return build(rootId, 0);
  }

  private _buildTopScripts(nodes: ProfileNode[], totalMs: number): { url: string; selfTimeMs: number; pct: number }[] {
    const scriptTimes = new Map<string, number>();

    for (const node of nodes) {
      if (node.selfTimeMs > 0 && node.callFrame.url) {
        scriptTimes.set(
          node.callFrame.url,
          (scriptTimes.get(node.callFrame.url) ?? 0) + node.selfTimeMs,
        );
      }
    }

    return Array.from(scriptTimes.entries())
      .map(([url, selfTimeMs]) => ({
        url,
        selfTimeMs,
        pct: totalMs > 0 ? (selfTimeMs / totalMs) * 100 : 0,
      }))
      .sort((a, b) => b.selfTimeMs - a.selfTimeMs)
      .slice(0, 20);
  }
}
