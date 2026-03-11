const path = require('path');

// Admin API keys from environment variables
const config = {
    port: process.env.BRIDGE_PORT || 3456,

    providers: {
        anthropic: {
            apiKey: process.env.ANTHROPIC_API_KEY || '',
            models: [
                { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', costPer1kTokens: 0.075 },
                { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', costPer1kTokens: 0.015 },
                { id: 'claude-haiku-4-5', name: 'Claude Haiku', costPer1kTokens: 0.001 },
            ]
        },
        openai: {
            apiKey: process.env.OPENAI_API_KEY || '',
            models: [
                { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', costPer1kTokens: 0.06 },
                { id: 'gpt-5.4', name: 'GPT-5.4 Thinking', costPer1kTokens: 0.03 },
                { id: 'gpt-5.3-instant', name: 'GPT-5.3 Instant', costPer1kTokens: 0.002 },
            ]
        },
        google: {
            apiKey: process.env.GOOGLE_API_KEY || '',
            models: [
                { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', costPer1kTokens: 0.035 },
                { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', costPer1kTokens: 0.005 },
                { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite', costPer1kTokens: 0.001 },
                { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', costPer1kTokens: 0.001 },
            ]
        },
        huggingface: {
            apiKey: process.env.HF_TOKEN || '',
            models: [
                { id: 'meta-llama/Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B (HF)', costPer1kTokens: 0 },
                { id: 'custom-hf-model', name: 'Custom HF Model', costPer1kTokens: 0 }
            ]
        },
        mistral: {
            apiKey: process.env.MISTRAL_API_KEY || '',
            models: [
                { id: 'mistral-large-latest', name: 'Mistral Large', costPer1kTokens: 0.002 },
                { id: 'pixtral-large-latest', name: 'Pixtral Large', costPer1kTokens: 0.002 },
                { id: 'ministral-8b-latest', name: 'Ministral 8B', costPer1kTokens: 0.0001 }
            ]
        },
        groq: {
            apiKey: process.env.GROQ_API_KEY || '',
            models: [
                { id: 'llama-3.3-70b-versatile', name: 'Groq Llama 3.3 70B', costPer1kTokens: 0.0006 },
                { id: 'llama3-70b-8192', name: 'Groq Llama 3 70B', costPer1kTokens: 0.0006 },
                { id: 'llama3-8b-8192', name: 'Groq Llama 3 8B', costPer1kTokens: 0.0001 },
                { id: 'gemma2-9b-it', name: 'Groq Gemma 2 9B', costPer1kTokens: 0.0002 }
            ]
        },
        bedrock: {
            apiKey: process.env.AWS_BEDROCK_API_KEY || '',
            awsRegion: process.env.AWS_REGION || 'us-east-1',
            models: [
                { id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', name: 'Bedrock Claude 3.5 Sonnet', costPer1kTokens: 0.003 },
                { id: 'us.anthropic.claude-3-haiku-20240307-v1:0', name: 'Bedrock Claude 3 Haiku', costPer1kTokens: 0.00025 },
                { id: 'us.meta.llama3-3-70b-instruct-v1:0', name: 'Bedrock Llama 3.3 70B', costPer1kTokens: 0.00072 },
                { id: 'us.amazon.nova-pro-v1:0', name: 'Bedrock Nova Pro', costPer1kTokens: 0.0008 }
            ]
        },
        ollama: {
            apiKey: 'not-required', // Ollama doesn't typically use auth
            models: [
                { id: 'ollama-local', name: 'Ollama (Local - localhost:11434)', costPer1kTokens: 0 },
                { id: 'ollama-tunnel', name: 'Ollama (Tunnel - Custom URL)', costPer1kTokens: 0 }
            ]
        }
    },

    // Credits: 1 credit = $0.01
    creditCostUSD: 0.01,

    // Session storage
    sessionDir: path.join(__dirname, '..', 'data', 'sessions'),
    uploadDir: path.join(__dirname, '..', 'data', 'uploads'),
};

module.exports = config;
