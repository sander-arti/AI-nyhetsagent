/**
 * OpenAI Model Provider
 *
 * Supports GPT-4o, GPT-4o-mini, and other OpenAI models
 */

import OpenAI from 'openai';
import {
  BaseModelProvider,
  ModelProviderRequest,
  ModelProviderResponse,
} from './base-provider.js';
import { getModelConfig } from '../../config/consensus.config.js';

export class OpenAIProvider extends BaseModelProvider {
  private client: OpenAI;

  constructor(modelId: string, apiKey: string) {
    super(modelId, apiKey);
    this.client = new OpenAI({ apiKey });
  }

  async generateCompletion(
    request: ModelProviderRequest
  ): Promise<ModelProviderResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ];

    const completionParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.modelId,
      messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };

    // Add JSON mode if requested
    if (request.responseFormat === 'json') {
      completionParams.response_format = { type: 'json_object' };
    }

    const completion = await this.client.chat.completions.create(completionParams);

    const content = completion.choices[0]?.message?.content || '';
    const usage = completion.usage;

    return {
      content,
      usage: {
        inputTokens: usage?.prompt_tokens || 0,
        outputTokens: usage?.completion_tokens || 0,
      },
      model: completion.model,
    };
  }

  calculateCost(inputTokens: number, outputTokens: number): number {
    const config = getModelConfig(this.modelId);
    if (!config) {
      throw new Error(`Model config not found for ${this.modelId}`);
    }

    const inputCost = (inputTokens / 1000) * config.costPer1kTokens.input;
    const outputCost = (outputTokens / 1000) * config.costPer1kTokens.output;

    return inputCost + outputCost;
  }
}
