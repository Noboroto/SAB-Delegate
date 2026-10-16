export const LLM_PRESETS = [
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  {
    value: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  { value: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
] as const;

export const LLM_PRESET_CUSTOM = 'custom';

/** The preset whose address is `baseUrl`, else the custom entry. */
export function presetOf(baseUrl: string | undefined): string {
  const address = (baseUrl ?? '').trim();
  return LLM_PRESETS.find((preset) => preset.baseUrl === address)?.value ?? LLM_PRESET_CUSTOM;
}
