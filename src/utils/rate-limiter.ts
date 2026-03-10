import Bottleneck from "bottleneck";

export function createSlackLimiter(): Bottleneck {
  return new Bottleneck({
    reservoir: 50,
    reservoirRefreshAmount: 50,
    reservoirRefreshInterval: 60 * 1000,
    maxConcurrent: 1,
    minTime: 1200,
  });
}

export function createTeamsLimiter(maxConcurrent = 1): Bottleneck {
  return new Bottleneck({
    reservoir: 5,
    reservoirRefreshAmount: 5,
    reservoirRefreshInterval: 1000,
    maxConcurrent: Math.min(Math.max(maxConcurrent, 1), 5),
    minTime: 200,
  });
}
