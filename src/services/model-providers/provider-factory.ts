/**
 * Model Provider Factory
 *
 * Creates appropriate provider based on model configuration
 */

import { BaseModelProvider } from './base-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { GoogleProvider } from './google-provider.js';
import { getModelConfig } from '../../config/consensus.config.js';

/**
 * Create model provider based on model ID
 */
export function createModelProvider(
  modelId: string,
  apiKeys: {
    openai?: string;
    anthropic?: string;
    google?: string;
  }
): BaseModelProvider {
  const config = getModelConfig(modelId);

  if (!config) {
    throw new Error(`Model configuration not found for: ${modelId}`);
  }

  switch (config.provider) {
    case 'openai':
      if (!apiKeys.openai) {
        throw new Error('OpenAI API key not provided');
      }
      return new OpenAIProvider(modelId, apiKeys.openai);

    case 'anthropic':
      if (!apiKeys.anthropic) {
        throw new Error('Anthropic API key not provided');
      }
      return new AnthropicProvider(modelId, apiKeys.anthropic);

    case 'google':
      if (!apiKeys.google) {
        throw new Error('Google API key not provided');
      }
      return new GoogleProvider(modelId, apiKeys.google);

    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

/**
 * Create multiple providers for consensus
 */
export function createModelProviders(
  modelIds: string[],
  apiKeys: {
    openai?: string;
    anthropic?: string;
    google?: string;
  }
): Map<string, BaseModelProvider> {
  const providers = new Map<string, BaseModelProvider>();

  for (const modelId of modelIds) {
    try {
      const provider = createModelProvider(modelId, apiKeys);
      providers.set(modelId, provider);
    } catch (error) {
      console.warn(`Failed to create provider for ${modelId}:`, error);
    }
  }

  return providers;
}
