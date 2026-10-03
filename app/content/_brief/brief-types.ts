// Shared client-side state for the daily brief reply form.

export type ResponseState = {
  rating: number | null;
  ratingComment: string;
  decision: "pick" | "reject" | null;
  scenarioIndex: number | null;
  scenarioText: string;
  answers: string[];
  rejectReason: string;
};

export function emptyState(): ResponseState {
  return { rating: null, ratingComment: "", decision: null, scenarioIndex: null, scenarioText: "", answers: [], rejectReason: "" };
}
