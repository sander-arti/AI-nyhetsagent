/**
 * Anthropic Model Provider
 *
 * Supports Claude 3.5 Sonnet, Claude 3 Haiku, and other Anthropic models
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  BaseModelProvider,
  ModelProviderRequest,
  ModelProviderResponse,
} from './base-provider.js';
import { getModelConfig } from '../../config/consensus.config.js';

export class AnthropicProvider extends BaseModelProvider {
  private client: Anthropic;

  constructor(modelId: string, apiKey: string) {
    super(modelId, apiKey);
    this.client = new Anthropic({ apiKey });
  }

  async generateCompletion(
    request: ModelProviderRequest
  ): Promise<ModelProviderResponse> {
    const message = await this.client.messages.create({
      model: this.modelId,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.systemPrompt,
      messages: [
        {
          role: 'user',
          content: request.userPrompt,
        },
      ],
    });

    const content =
      message.content[0]?.type === 'text' ? message.content[0].text : '';

    return {
      content,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      model: message.model,
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
