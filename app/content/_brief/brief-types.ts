// Shared client-side state for the daily brief reply form.

export type ResponseState = {
  rating: number | null;
  ratingComment: string;
  decision: "pick" | "reject" | null;
  scenarioIndex: number | null;
  scenarioText: string;
  scenarioCustom: string;
  answers: string[];
  rejectReason: string;
};

export function emptyState(): ResponseState {
  return {
    rating: null,
    ratingComment: "",
    decision: null,
    scenarioIndex: null,
    scenarioText: "",
    scenarioCustom: "",
    answers: [],
    rejectReason: "",
  };
}

/**
 * 简报选题的管线状态（`brief_selections` 行的前端形态）。字段与
 * `lib/brief-pipeline.ts` 的 `SelectionView` 对齐，但这里只声明展示需要的部分，
 * 避免客户端组件 import 服务端模块。
 */
export type BriefSelection = {
  topicId: string;
  boardTopicId: number | null;
  status: string;
  statusLabel: string;
  outlineMd: string;
  outlineBy: string;
  outlineAt: string | null;
  statusBy: string;
  statusAt: string | null;
  notifyEvent: string | null;
  notifyState: string | null;
  notifyHttpStatus: number | null;
  notifyError: string | null;
  notifyAt: string | null;
};

/** 场景/回答自动保存的指示状态。 */
export type AutosaveStatus = "saving" | "saved" | "error";
