import type { ModelProviderCard } from '@/types/llm';

const heihub: ModelProviderCard = {
  chatModels: [],
  description:
    'heihub Cloud uses official APIs to access AI models and measures usage with Credits tied to model tokens.',
  enabled: true,
  id: 'lobehub',
  modelsUrl: 'https://lobehub.com/zh/docs/usage/subscription/model-pricing',
  name: 'heihub',
  settings: {
    modelEditable: false,
    showAddNewModel: false,
    showModelFetcher: false,
  },
  showConfig: false,
  url: 'https://lobehub.com',
};

export default LobeHub;

export const planCardModels = [
  'claude-sonnet-4-6',
  'gemini-3.1-pro-preview',
  'gpt-5.4',
  'deepseek-chat',
];
