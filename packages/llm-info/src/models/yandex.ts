import { LlmInfo } from "../types.js";

export const YandexAiLlms: LlmInfo[] = [
  {
    model: "yandexgpt",
    displayName: "YandexGPT",
    contextLength: 16_385,
    maxCompletionTokens: 4096,
  },
  {
    model: "yandexgpt",
    displayName: "YandexGPT-Lite",
    contextLength: 16_385,
    maxCompletionTokens: 4096,
  },
];
