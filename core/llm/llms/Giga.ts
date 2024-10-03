import {
  ChatMessage,
  CompletionOptions,
  LLMOptions,
  ModelProvider,
} from "../../index.js";
import { stripImages } from "../images.js";
import { BaseLLM } from "../index.js";
import { streamSse } from "../stream.js";

const NON_CHAT_MODELS = ["kandinsky"];

const CHAT_ONLY_MODELS = [
  "GigaChat",
  "GigaChat-Plus",
  "GigaChat-Pro",
];

class Giga extends BaseLLM {
  public useLegacyCompletionsEndpoint: boolean | undefined = undefined;

  maxStopWords: number | undefined = undefined;

  constructor(options: LLMOptions) {
    super(options);
    this.useLegacyCompletionsEndpoint = options.useLegacyCompletionsEndpoint;
    this.apiVersion = options.apiVersion ?? "2023-07-01-preview";
  }

  static providerName: ModelProvider = "openai";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://gigachat.devices.sberbank.ru/api/v1/",
  };

  protected _convertMessage(message: ChatMessage) {
    if (typeof message.content === "string") {
      return message;
    } else if (!message.content.some((item) => item.type !== "text")) {
      // If no multi-media is in the message, just send as text
      // for compatibility with OpenAI "compatible" servers
      // that don't support multi-media format
      return {
        ...message,
        content: message.content.map((item) => item.text).join(""),
      };
    }

    const parts = message.content.map((part) => {
      const msg: any = {
        type: part.type,
        text: part.text,
      };
      if (part.type === "imageUrl") {
        msg.image_url = { ...part.imageUrl, detail: "low" };
        msg.type = "image_url";
      }
      return msg;
    });
    return {
      ...message,
      content: parts,
    };
  }

  protected _convertModelName(model: string): string {
    return model;
  }

  private isO1Model(model?: string): boolean {
    return (
      !!model && (model.startsWith("o1-preview") || model.startsWith("o1-mini"))
    );
  }

  protected _convertArgs(options: any, messages: ChatMessage[]) {
    const url = new URL(this.apiBase!);
    const finalOptions: any = {
      messages: messages.map(this._convertMessage),
      model: this._convertModelName(options.model),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      top_p: options.topP,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      stream: options.stream ?? true,
      stop:
        // Jan + Azure OpenAI don't truncate and will throw an error
        this.maxStopWords !== undefined
          ? options.stop?.slice(0, this.maxStopWords)
          : url.host === "api.deepseek.com"
            ? options.stop?.slice(0, 16)
            : url.port === "1337" ||
                url.host === "api.openai.com" ||
                url.host === "api.groq.com" ||
                this.apiType === "azure"
              ? options.stop?.slice(0, 4)
              : options.stop,
    };

    // OpenAI o1-preview and o1-mini:
    if (this.isO1Model(options.model)) {
      // a) use max_completion_tokens instead of max_tokens
      finalOptions.max_completion_tokens = options.maxTokens;
      finalOptions.max_tokens = undefined;

      // b) don't support streaming currently
      finalOptions.stream = false;

      // c) don't support system message
      finalOptions.messages = finalOptions.messages?.filter(
        (message: any) => message?.role !== "system",
      );
    }

    return finalOptions;
  }

  protected _getHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "api-key": this.apiKey ?? "", // For Azure
    };
  }

  protected async _complete(
    prompt: string,
    options: CompletionOptions,
  ): Promise<string> {
    let completion = "";
    for await (const chunk of this._streamChat(
      [{ role: "user", content: prompt }],
      options,
    )) {
      completion += chunk.content;
    }

    return completion;
  }

  protected _getEndpoint(
    endpoint: "chat/completions" | "completions" | "models",
  ) {
    if (this.apiType === "azure") {
      return new URL(
        `openai/deployments/${this.engine}/${endpoint}?api-version=${this.apiVersion}`,
        this.apiBase,
      );
    }
    if (!this.apiBase) {
      throw new Error(
        "No API base URL provided. Please set the 'apiBase' option in config.json",
      );
    }

    return new URL(endpoint, this.apiBase);
  }

  protected async *_streamComplete(
    prompt: string,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    for await (const chunk of this._streamChat(
      [{ role: "user", content: prompt }],
      options,
    )) {
      yield stripImages(chunk.content);
    }
  }

  protected async *_legacystreamComplete(
    prompt: string,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    const args: any = this._convertArgs(options, []);
    args.prompt = prompt;
    args.messages = undefined;

    const response = await this.fetch(this._getEndpoint("completions"), {
      method: "POST",
      headers: this._getHeaders(),
      body: JSON.stringify({
        ...args,
        stream: true,
      }),
    });

    for await (const value of streamSse(response)) {
      if (value.choices?.[0]?.text && value.finish_reason !== "eos") {
        yield value.choices[0].text;
      }
    }
  }

  protected async *_streamChat(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    if (
      !CHAT_ONLY_MODELS.includes(options.model) &&
      this.supportsCompletions() &&
      (NON_CHAT_MODELS.includes(options.model) ||
        this.useLegacyCompletionsEndpoint ||
        options.raw)
    ) {
      for await (const content of this._legacystreamComplete(
        stripImages(messages[messages.length - 1]?.content || ""),
        options,
      )) {
        yield {
          role: "assistant",
          content,
        };
      }
      return;
    }

    const body = this._convertArgs(options, messages);
    // Empty messages cause an error in LM Studio
    body.messages = body.messages.map((m: any) => ({
      ...m,
      content: m.content === "" ? " " : m.content,
    })) as any;
    const response = await this.fetch(this._getEndpoint("chat/completions"), {
      method: "POST",
      headers: this._getHeaders(),
      body: JSON.stringify(body),
    });

    // Handle non-streaming response
    if (body.stream === false) {
      const data = await response.json();
      yield data.choices[0].message;
      return;
    }

    for await (const value of streamSse(response)) {
      if (value.choices?.[0]?.delta?.content) {
        yield value.choices[0].delta;
      }
    }
  }

  async *_streamFim(
    prefix: string,
    suffix: string,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    const endpoint = new URL("fim/completions", this.apiBase);
    const resp = await this.fetch(endpoint, {
      method: "POST",
      body: JSON.stringify({
        model: options.model,
        prompt: prefix,
        suffix,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stop: options.stop,
        stream: true,
      }),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": this.apiKey ?? "",
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    for await (const chunk of streamSse(resp)) {
      yield chunk.choices[0].delta.content;
    }
  }

  async listModels(): Promise<string[]> {
    const response = await this.fetch(this._getEndpoint("models"), {
      method: "GET",
      headers: this._getHeaders(),
    });

    const data = await response.json();
    return data.data.map((m: any) => m.id);
  }
}

export default Giga;


// import { randomUUID } from 'crypto';

// const AUTH_DATA = 'ZTEzYzY0OWQtYjNlYy00ZDYwLWI4NzYtZWMwZjg4OTkyMDhjOjM0NmI3ZGNjLTVkODUtNDIwNy04ODkxLWMxNDk0NTI2YjI1NQ=='

// //! bash cmd pre-request
// // export NODE_TLS_REJECT_UNAUTHORIZED='0'

// const responseApiKey = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
//   method: 'POST',
//   headers: {
//     'Content-Type': 'application/x-www-form-urlencoded',
//     'Accept': 'application/json',
//     'RqUID': randomUUID(),
//     'Authorization': `Basic ${AUTH_DATA}`
//   },
//   body: new URLSearchParams({ scope: 'GIGACHAT_API_PERS' }).toString(),
// }).then(d => d.json())

// // Запрос на генерацию можно передавать моделям в раннем доступе. Для обращения к ним используйте адрес https://gigachat-preview.devices.sberbank.ru/, а к названию модели, которое передается в поле model, добавьте постфикс -preview.
// // EXAMPLE: https://gigachat-preview.devices.sberbank.ru/api/v1/chat/completions, model: GigaChat-preview.
// const response = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
//   method: 'post',
//   headers: { 
//     'Content-Type': 'application/json', 
//     'Accept': 'application/json', 
//     'Authorization': `Bearer ${responseApiKey.access_token}`
//   },
//   body: JSON.stringify({
//     "model": "GigaChat",
//     "messages": [
//       {
//         "role": "system",
//         "content": "Ты профессиональный переводчик на английский язык. Переведи точно сообщение пользователя."
//       },
//       {
//         "role": "user",
//         "content": "GigaChat — это сервис, который умеет взаимодействовать с пользователем в формате диалога, писать код, создавать тексты и картинки по запросу пользователя."
//       }
//     ],
//     "n": 1,
//     "stream": false,
//     "update_interval": 0
//   })
// }).then(d => d.json())

// console.dir(response)