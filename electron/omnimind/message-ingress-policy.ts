export const bootstrapWatermark = (sessionTimestamp: number, nowSeconds: number): number =>
  Number.isFinite(sessionTimestamp) && sessionTimestamp > 0 ? sessionTimestamp : nowSeconds

export const failedFetchResult = (previousTimestamp: number, expectedIncomingCount: number) => ({
  fetched: false,
  maxFetchedTimestamp: previousTimestamp,
  incomingCandidateCount: 0,
  observedIncomingCount: 0,
  expectedIncomingCount,
  retry: true
})

export const nextInspectedWatermark = (previousTimestamp: number, currentTimestamp: number, fetchedTimestamp: number, retry: boolean): number =>
  retry ? previousTimestamp : Math.max(previousTimestamp, currentTimestamp, fetchedTimestamp)
