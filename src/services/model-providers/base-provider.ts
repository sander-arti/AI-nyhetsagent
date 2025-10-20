/**
 * Base Model Provider Interface
 *
 * Abstract interface for LLM providers (OpenAI, Anthropic, Google)
 */

import { ParsedItem } from '../../types/schemas.js';
import { ModelResult } from '../../types/consensus.types.js';

export interface ModelProviderRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  responseFormat?: 'json' | 'text';
}

export interface ModelProviderResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
}

/**
 * Base provider interface
 */
export abstract class BaseModelProvider {
  protected modelId: string;
  protected apiKey: string;

  constructor(modelId: string, apiKey: string) {
    this.modelId = modelId;
    this.apiKey = apiKey;
  }

  /**
   * Generate completion from model
   */
  abstract generateCompletion(
    request: ModelProviderRequest
  ): Promise<ModelProviderResponse>;

  /**
   * Calculate cost based on token usage
   */
  abstract calculateCost(inputTokens: number, outputTokens: number): number;

  /**
   * Get model ID
   */
  getModelId(): string {
    return this.modelId;
  }
}
