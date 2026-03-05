export interface ChangePoint {
  index: number;
  timestamp?: number;
  beforeMean: number;
  afterMean: number;
  changePct: number;
  significance: number;
}

export type VarianceClassification = 'stable' | 'noisy' | 'trending_up' | 'trending_down' | 'erratic';

export default class NoiseFilter {
  public removeOutliers(data: number[], iqrMultiplier: number = 1.5): number[] {
    if (data.length < 4) return data.slice();

    const sorted = data.slice().sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - iqrMultiplier * iqr;
    const upper = q3 + iqrMultiplier * iqr;

    return data.filter(v => v >= lower && v <= upper);
  }

  public movingAverage(data: number[], windowSize: number = 5): number[] {
    if (data.length === 0) return [];
    if (windowSize < 1) windowSize = 1;
    if (windowSize > data.length) windowSize = data.length;

    const result: number[] = [];
    let windowSum = 0;

    for (let i = 0; i < windowSize; i++) {
      windowSum += data[i];
    }

    result.push(windowSum / windowSize);

    for (let i = windowSize; i < data.length; i++) {
      windowSum += data[i] - data[i - windowSize];
      result.push(windowSum / windowSize);
    }

    return result;
  }

  public detectChangePoints(data: number[], minSegmentSize: number = 10, thresholdPct: number = 10): ChangePoint[] {
    if (data.length < minSegmentSize * 2) return [];

    const changePoints: ChangePoint[] = [];

    for (let i = minSegmentSize; i <= data.length - minSegmentSize; i++) {
      const before = data.slice(i - minSegmentSize, i);
      const after = data.slice(i, i + minSegmentSize);

      const beforeMean = this._mean(before);
      const afterMean = this._mean(after);

      if (beforeMean === 0) continue;

      const changePct = ((afterMean - beforeMean) / beforeMean) * 100;

      if (Math.abs(changePct) >= thresholdPct) {
        const beforeStd = this._std(before);
        const afterStd = this._std(after);
        const pooledStd = Math.sqrt((beforeStd * beforeStd + afterStd * afterStd) / 2);
        const significance = pooledStd > 0
          ? Math.abs(afterMean - beforeMean) / pooledStd
          : Math.abs(changePct) / 10;

        if (significance > 1.5) {
          const lastCp = changePoints[changePoints.length - 1];

          if (!lastCp || i - lastCp.index > minSegmentSize) {
            changePoints.push({
              index: i,
              beforeMean,
              afterMean,
              changePct,
              significance,
            });
          }
        }
      }
    }

    return changePoints;
  }

  public classifyVariance(data: number[]): VarianceClassification {
    if (data.length < 5) return 'stable';

    const mean = this._mean(data);
    const std = this._std(data);
    const cv = mean > 0 ? std / mean : 0;

    if (cv > 0.5) return 'erratic';

    const firstHalf = data.slice(0, Math.floor(data.length / 2));
    const secondHalf = data.slice(Math.floor(data.length / 2));
    const firstMean = this._mean(firstHalf);
    const secondMean = this._mean(secondHalf);

    if (firstMean > 0) {
      const trendPct = ((secondMean - firstMean) / firstMean) * 100;

      if (trendPct > 10) return 'trending_up';
      if (trendPct < -10) return 'trending_down';
    }

    if (cv > 0.15) return 'noisy';

    return 'stable';
  }

  public smoothAndAnalyze(data: number[], windowSize: number = 5): {
    raw: number[];
    smoothed: number[];
    outlierCount: number;
    variance: VarianceClassification;
    changePoints: ChangePoint[];
  } {
    const cleaned = this.removeOutliers(data);
    const smoothed = this.movingAverage(cleaned, windowSize);

    return {
      raw: data,
      smoothed,
      outlierCount: data.length - cleaned.length,
      variance: this.classifyVariance(cleaned),
      changePoints: this.detectChangePoints(cleaned),
    };
  }

  private _mean(data: number[]): number {
    if (data.length === 0) return 0;

    return data.reduce((s, v) => s + v, 0) / data.length;
  }

  private _std(data: number[]): number {
    if (data.length < 2) return 0;

    const mean = this._mean(data);
    const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / (data.length - 1);

    return Math.sqrt(variance);
  }
}
