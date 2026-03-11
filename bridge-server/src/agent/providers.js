/**
 * Multi-LLM Provider Adapter
 * Unified interface for Anthropic, OpenAI, and Google APIs
 */

class LLMProvider {
    constructor(config) {
        this.config = config;
        this.clients = {};
    }

    getProviderForModel(modelId) {
        for (const [provider, conf] of Object.entries(this.config.providers)) {
            const model = conf.models.find(m => m.id === modelId);
            if (model) return { provider, model, apiKey: conf.apiKey };
        }

        // Fallback for custom Hugging Face models typed in from the UI
        return {
            provider: 'huggingface',
            model: { id: modelId, name: modelId, costPer1kTokens: 0 },
            apiKey: this.config.providers.huggingface.apiKey
        };
    }

    getAllModels() {
        const models = [];
        for (const [provider, conf] of Object.entries(this.config.providers)) {
            conf.models.forEach(m => {
                models.push({ ...m, provider, available: !!conf.apiKey });
            });
        }
        return models;
    }

    async chat(modelId, messages, options = {}) {
        const { provider, model, apiKey } = this.getProviderForModel(modelId);

        const finalApiKey = options?.apiKeys?.[provider] || apiKey;

        if (!finalApiKey && provider !== 'ollama') {
            throw new Error(`API key not configured for ${provider}. Provide it in settings or .env file.`);
        }

        switch (provider) {
            case 'anthropic':
                return this._chatAnthropic(modelId, finalApiKey, messages, options);
            case 'openai':
                return this._chatOpenAI(modelId, finalApiKey, messages, options);
            case 'google':
                return this._chatGoogle(modelId, finalApiKey, messages, options);
            case 'huggingface':
                return this._chatHuggingFace(modelId, finalApiKey, messages, options);
            case 'mistral':
                return this._chatMistral(modelId, finalApiKey, messages, options);
            case 'groq':
                return this._chatGroq(modelId, finalApiKey, messages, options);
            case 'bedrock':
                return this._chatBedrock(modelId, finalApiKey, messages, options);
            case 'ollama':
                return this._chatOllama(modelId, messages, options);
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
    }

    async _chatAnthropic(modelId, apiKey, messages, options) {
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        const systemMsg = messages.find(m => m.role === 'system');
        const chatMsgs = messages.filter(m => m.role !== 'system');

        const resp = await client.messages.create({
            model: modelId,
            system: systemMsg?.content || '',
            messages: chatMsgs.map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content
            }))
        });

        const text = resp.content.map(c => c.text).join('');
        return {
            content: text,
            usage: {
                inputTokens: resp.usage?.input_tokens || 0,
                outputTokens: resp.usage?.output_tokens || 0
            }
        };
    }

    async _chatOpenAI(modelId, apiKey, messages, options) {
        const OpenAI = require('openai');
        const client = new OpenAI({ apiKey });

        const resp = await client.chat.completions.create({
            model: modelId,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content
            }))
        });

        return {
            content: resp.choices[0]?.message?.content || '',
            usage: {
                inputTokens: resp.usage?.prompt_tokens || 0,
                outputTokens: resp.usage?.completion_tokens || 0
            }
        };
    }

    async _chatGoogle(modelId, apiKey, messages, options) {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelId });

        const systemMsg = messages.find(m => m.role === 'system');
        const chatMsgs = messages.filter(m => m.role !== 'system');

        let history = [];
        let expectedRole = 'user';

        // Build history applying strict rules: must start with 'user', must alternate
        const rawHistoryMsgs = chatMsgs.slice(0, -1);

        for (const m of rawHistoryMsgs) {
            const mappedRole = m.role === 'assistant' ? 'model' : 'user';

            if (history.length === 0 && mappedRole === 'model') {
                // Prepend dummy user message if history starts with model
                history.push({ role: 'user', parts: [{ text: 'Refer to previous context.' }] });
                expectedRole = 'model';
            }

            if (mappedRole !== expectedRole) {
                // If two contiguous of same role, just append to last message's text
                if (history.length > 0) {
                    history[history.length - 1].parts[0].text += '\n\n' + m.content;
                } else {
                    history.push({ role: mappedRole, parts: [{ text: m.content }] });
                    expectedRole = mappedRole === 'user' ? 'model' : 'user';
                }
            } else {
                history.push({ role: mappedRole, parts: [{ text: m.content }] });
                expectedRole = mappedRole === 'user' ? 'model' : 'user';
            }
        }

        const chat = model.startChat({
            history,
            systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined
        });

        const lastMsg = chatMsgs[chatMsgs.length - 1];
        const result = await chat.sendMessage(lastMsg.content);
        const resp = result.response;

        return {
            content: resp.text(),
            usage: {
                inputTokens: resp.usageMetadata?.promptTokenCount || 0,
                outputTokens: resp.usageMetadata?.candidatesTokenCount || 0
            }
        };
    }

    async _chatHuggingFace(modelId, apiKey, messages, options) {
        const { HfInference } = require('@huggingface/inference');
        const hf = new HfInference(apiKey);

        const systemMsg = messages.find(m => m.role === 'system');
        const chatMsgs = messages.filter(m => m.role !== 'system');

        const hfMessages = [];
        if (systemMsg) {
            hfMessages.push({ role: 'system', content: systemMsg.content });
        }
        chatMsgs.forEach(m => {
            hfMessages.push({ role: m.role, content: m.content });
        });

        // Some HF models do not expose usage tokens
        let inputTokens = 0;
        let outputTokens = 0;
        let content = '';

        try {
            const response = await hf.chatCompletion({
                model: modelId,
                messages: hfMessages
            });

            content = response.choices[0]?.message?.content || '';

            if (response.usage) {
                inputTokens = response.usage.prompt_tokens || 0;
                outputTokens = response.usage.completion_tokens || 0;
            }
        } catch (error) {
            throw new Error(`Hugging Face API Error: ${error.message || 'Rate limit or quota exceeded. Please check your API key.'}`);
        }

        return {
            content,
            usage: {
                inputTokens,
                outputTokens
            }
        };
    }

    async _chatMistral(modelId, apiKey, messages, options) {
        const { Mistral } = require('@mistralai/mistralai');
        const client = new Mistral({ apiKey });

        const resp = await client.chat.complete({
            model: modelId,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content
            }))
        });

        return {
            content: resp.choices[0]?.message?.content || '',
            usage: {
                inputTokens: resp.usage?.promptTokens || 0,
                outputTokens: resp.usage?.completionTokens || 0
            }
        };
    }

    async _chatGroq(modelId, apiKey, messages, options) {
        const Groq = require('groq-sdk');
        const groq = new Groq({ apiKey });

        const resp = await groq.chat.completions.create({
            model: modelId,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content
            }))
        });

        return {
            content: resp.choices[0]?.message?.content || '',
            usage: {
                inputTokens: resp.usage?.prompt_tokens || 0,
                outputTokens: resp.usage?.completion_tokens || 0
            }
        };
    }

    async _chatBedrock(modelId, apiKey, messages, options) {
        const conf = this.config.providers.bedrock;
        const region = options?.apiKeys?.awsRegion || conf.awsRegion || 'us-east-1';
        const bearerToken = apiKey; 

        if (!bearerToken) {
            throw new Error('AWS Bedrock API Key not configured.');
        }

        const systemMessages = messages.filter(m => m.role === 'system').map(m => ({ text: m.content }));
        
        const conversationMessages = [];
        const filtered = messages.filter(m => m.role !== 'system');
        
        for (const msg of filtered) {
            const role = msg.role === 'assistant' ? 'assistant' : 'user';
            if (conversationMessages.length > 0 && conversationMessages[conversationMessages.length - 1].role === role) {
                conversationMessages[conversationMessages.length - 1].content[0].text += '\n\n' + msg.content;
            } else {
                conversationMessages.push({
                    role: role,
                    content: [{ text: msg.content }]
                });
            }
        }

        if (conversationMessages.length > 0 && conversationMessages[0].role !== 'user') {
            conversationMessages.unshift({
                role: 'user',
                content: [{ text: 'Please begin.' }]
            });
        }

        const body = {
            messages: conversationMessages,
            inferenceConfig: {
                maxTokens: 8192
            }
        };
        if (systemMessages.length > 0) {
            body.system = systemMessages;
        }

        const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/converse`;

        let response;
        let retries = 3;
        while (retries > 0) {
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${bearerToken}`
                    },
                    body: JSON.stringify(body)
                });

                if (response.ok) {
                    break;
                } else {
                    const status = response.status;
                    const errText = await response.text();
                    
                    if (status === 429 || status >= 500) {
                        retries--;
                        if (retries === 0) throw new Error(`Bedrock API Error ${status}: ${errText}`);
                        console.log(`[Bedrock HTTP ${status}] Retrying... (${3 - retries}/3)`);
                        await new Promise(r => setTimeout(r, Math.min(10000, 2000 * (4 - retries))));
                    } else {
                        throw new Error(`Bedrock API Error ${status}: ${errText}`);
                    }
                }
            } catch (networkError) {
                if (networkError.message.includes('Bedrock API Error')) throw networkError; // Re-throw intentional HTTP errors

                retries--;
                if (retries === 0) {
                    throw new Error(`Bedrock Network Fetch Failed: ${networkError.message}`);
                }
                console.log(`[Bedrock Connection Failed: ${networkError.message}] Retrying... (${3 - retries}/3)`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        const data = await response.json();

        return {
            content: data.output?.message?.content?.[0]?.text || '',
            usage: {
                inputTokens: data.usage?.inputTokens || 0,
                outputTokens: data.usage?.outputTokens || 0
            }
        };
    }

    async _chatOllama(modelId, messages, options) {
        // Find the base URL
        let baseUrl = 'http://localhost:11434';
        if (modelId === 'ollama-tunnel') {
            baseUrl = options.apiKeys?.ollamaUrl || 'http://localhost:11434';
        }

        // Clean trailing slashes
        baseUrl = baseUrl.replace(/\/$/, "");

        // The user must specify the ACTUAL ollama model name (e.g. "llama3"). 
        // We will pass this through options, defaulting to llama3.1 if not provided.
        const actualModelName = options.apiKeys?.ollamaModel || 'llama3.1';

        const ollamaMessages = messages.map(m => ({
            role: m.role,
            content: m.content
        }));

        try {
            const response = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': '69420',
                    'User-Agent': 'RoboBuilder/1.0'
                },
                body: JSON.stringify({
                    model: actualModelName,
                    messages: ollamaMessages,
                    stream: false,
                    format: 'json'
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Status ${response.status}: ${errText}`);
            }

            const data = await response.json();

            return {
                content: data.message?.content || '',
                usage: {
                    inputTokens: data.prompt_eval_count || 0,
                    outputTokens: data.eval_count || 0
                }
            };
        } catch (error) {
            throw new Error(`Ollama API Error (${baseUrl}): ${error.message}. Ensure Ollama is running or the tunnel is active.`);
        }
    }
}

module.exports = LLMProvider;
