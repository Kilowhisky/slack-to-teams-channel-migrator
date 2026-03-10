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

export function createTeamsLimiter(): Bottleneck {
  return new Bottleneck({
    reservoir: 5,
    reservoirRefreshAmount: 5,
    reservoirRefreshInterval: 1000,
    maxConcurrent: 1,
    minTime: 200,
  });
}
