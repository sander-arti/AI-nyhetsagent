/**
 * Google Model Provider
 *
 * Supports Gemini 1.5 Pro, Gemini 1.5 Flash, and other Google models
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  BaseModelProvider,
  ModelProviderRequest,
  ModelProviderResponse,
} from './base-provider.js';
import { getModelConfig } from '../../config/consensus.config.js';

export class GoogleProvider extends BaseModelProvider {
  private client: GoogleGenerativeAI;

  constructor(modelId: string, apiKey: string) {
    super(modelId, apiKey);
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generateCompletion(
    request: ModelProviderRequest
  ): Promise<ModelProviderResponse> {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        ...(request.responseFormat === 'json' && {
          responseMimeType: 'application/json',
        }),
      },
      systemInstruction: request.systemPrompt,
    });

    const result = await model.generateContent(request.userPrompt);
    const response = result.response;
    const content = response.text();

    // Note: Google doesn't provide token usage in the same way
    // We'll estimate based on character count
    const inputTokens = Math.ceil(
      (request.systemPrompt.length + request.userPrompt.length) / 4
    );
    const outputTokens = Math.ceil(content.length / 4);

    return {
      content,
      usage: {
        inputTokens,
        outputTokens,
      },
      model: this.modelId,
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
