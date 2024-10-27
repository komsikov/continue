import { AnthropicLlms } from "./models/anthropic.js";
import { GoogleLlms } from "./models/google.js";
import { MistralLlms } from "./models/mistral.js";
import { OpenAiLlms } from "./models/openai.js";
import { YandexAiLlms } from "./models/yandex.js";
import { GigaAiLlms } from "./models/giga.js";
import { LlmInfo } from "./types.js";

export const allLlms: LlmInfo[] = [
  ...GigaAiLlms,
  ...YandexAiLlms,
  ...OpenAiLlms,
  ...GoogleLlms,
  ...AnthropicLlms,
  ...MistralLlms,
];

export function findLlmInfo(model: string): LlmInfo | undefined {
  return allLlms.find((llm) =>
    llm.regex ? llm.regex.test(model) : llm.model === model,
  );
}
