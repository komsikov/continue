import { ModelProvider } from "../types.js";

export const Giga: ModelProvider = {
  id: "yandexgpt",
  displayName: "YandexGPT",
  models: [
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
  ],
}
