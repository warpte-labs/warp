/**
 * ACP session model state (session/new + session/set_model + notifications).
 *
 * Grok fork exposes availableModels + reasoningEfforts on session/new.
 * Effort is switched via session/set_model with _meta.reasoningEffort.
 */

export const REASONING_EFFORT_META_KEY = "reasoningEffort";

export type ReasoningEffortOption = {
  id: string;
  value: string;
  label: string;
  description?: string;
  default?: boolean;
};

export type ModelInfo = {
  modelId: string;
  name: string;
  description?: string;
  supportsReasoningEffort: boolean;
  reasoningEffort?: string;
  reasoningEfforts: ReasoningEffortOption[];
  /** Context window size from ACP model _meta.totalContextTokens */
  totalContextTokens?: number;
};

export type ModelState = {
  currentModelId: string;
  reasoningEffort?: string;
  availableModels: ModelInfo[];
};

/** Live context usage for the footer indicator. */
export type ContextUsage = {
  usedTokens: number;
  totalTokens: number;
};

export function emptyModelState(): ModelState {
  return {
    currentModelId: "",
    reasoningEffort: undefined,
    availableModels: [],
  };
}

export function contextWindowOf(state: ModelState): number {
  const cur =
    state.availableModels.find((m) => m.modelId === state.currentModelId) ||
    state.availableModels[0];
  return cur?.totalContextTokens || 500_000;
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function parseEffortOption(raw: unknown): ReasoningEffortOption | null {
  const o = asRecord(raw);
  if (!o) {
    return null;
  }
  const id = typeof o.id === "string" ? o.id : "";
  const value =
    typeof o.value === "string" ? o.value : id;
  if (!id && !value) {
    return null;
  }
  return {
    id: id || value,
    value: value || id,
    label:
      typeof o.label === "string"
        ? o.label
        : (value || id).replace(/^\w/, (c) => c.toUpperCase()),
    description:
      typeof o.description === "string" ? o.description : undefined,
    default: o.default === true,
  };
}

function parseModelInfo(raw: unknown): ModelInfo | null {
  const o = asRecord(raw);
  if (!o) {
    return null;
  }
  const modelId =
    typeof o.modelId === "string"
      ? o.modelId
      : typeof o.model_id === "string"
        ? o.model_id
        : "";
  if (!modelId) {
    return null;
  }
  const meta = asRecord(o._meta) || {};
  const effortsRaw = Array.isArray(meta.reasoningEfforts)
    ? meta.reasoningEfforts
    : Array.isArray(o.reasoningEfforts)
      ? o.reasoningEfforts
      : [];
  const reasoningEfforts = effortsRaw
    .map(parseEffortOption)
    .filter((e): e is ReasoningEffortOption => e != null);

  const supports =
    meta.supportsReasoningEffort === true ||
    o.supportsReasoningEffort === true ||
    reasoningEfforts.length > 0;

  const effort =
    typeof meta.reasoningEffort === "string"
      ? meta.reasoningEffort
      : typeof o.reasoningEffort === "string"
        ? o.reasoningEffort
        : reasoningEfforts.find((e) => e.default)?.value;

  const totalContextTokens =
    typeof meta.totalContextTokens === "number"
      ? meta.totalContextTokens
      : typeof meta.total_context_tokens === "number"
        ? meta.total_context_tokens
        : typeof o.totalContextTokens === "number"
          ? o.totalContextTokens
          : undefined;

  return {
    modelId,
    name:
      typeof o.name === "string" && o.name.trim()
        ? o.name
        : modelId,
    description:
      typeof o.description === "string" ? o.description : undefined,
    supportsReasoningEffort: supports,
    reasoningEffort: effort,
    reasoningEfforts,
    totalContextTokens,
  };
}

/** Parse SessionModelState from session/new result or _x.ai/models/update. */
export function parseModelState(raw: unknown): ModelState | null {
  const root = asRecord(raw);
  if (!root) {
    return null;
  }
  // session/new nests under .models; notifications may be flat
  const models = asRecord(root.models) || root;
  const currentModelId =
    typeof models.currentModelId === "string"
      ? models.currentModelId
      : typeof models.current_model_id === "string"
        ? models.current_model_id
        : "";
  const listRaw = Array.isArray(models.availableModels)
    ? models.availableModels
    : Array.isArray(models.available_models)
      ? models.available_models
      : [];
  const availableModels = listRaw
    .map(parseModelInfo)
    .filter((m): m is ModelInfo => m != null);

  if (!currentModelId && !availableModels.length) {
    return null;
  }

  const current =
    availableModels.find((m) => m.modelId === currentModelId) ||
    availableModels[0];
  const reasoningEffort =
    current?.reasoningEffort ||
    (typeof models.reasoningEffort === "string"
      ? models.reasoningEffort
      : typeof models.reasoning_effort === "string"
        ? models.reasoning_effort
        : undefined);

  return {
    currentModelId: currentModelId || current?.modelId || "",
    reasoningEffort,
    availableModels,
  };
}

/** Apply model_changed notification into existing state. */
export function applyModelChanged(
  state: ModelState,
  update: Record<string, unknown>
): ModelState {
  const modelId =
    typeof update.model_id === "string"
      ? update.model_id
      : typeof update.modelId === "string"
        ? update.modelId
        : state.currentModelId;
  const effort =
    typeof update.reasoning_effort === "string"
      ? update.reasoning_effort
      : typeof update.reasoningEffort === "string"
        ? update.reasoningEffort
        : state.reasoningEffort;

  const availableModels = state.availableModels.map((m) =>
    m.modelId === modelId
      ? { ...m, reasoningEffort: effort }
      : m
  );

  return {
    currentModelId: modelId,
    reasoningEffort: effort,
    availableModels,
  };
}

export function displayModelLabel(state: ModelState): string {
  const m =
    state.availableModels.find((x) => x.modelId === state.currentModelId) ||
    state.availableModels[0];
  const name = m?.name || state.currentModelId || "Model";
  if (!state.reasoningEffort || !m?.supportsReasoningEffort) {
    return name;
  }
  const opt = m.reasoningEfforts.find(
    (e) => e.value === state.reasoningEffort || e.id === state.reasoningEffort
  );
  const effortLabel =
    opt?.label?.replace(/\s*Effort$/i, "") ||
    state.reasoningEffort.charAt(0).toUpperCase() +
      state.reasoningEffort.slice(1);
  return `${name} · ${effortLabel}`;
}
