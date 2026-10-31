// Global variables
let availableModels = [];
let currentFiles = [];
let conversationHistory = [];
let modelLoadTimeout;

// DOM elements
const elements = {
    languageSelect: null,
    themeSelect: null,
    settingsButton: null,
    settingsPanel: null,
    closeSettings: null,
    temperatureSlider: null,
    temperatureValue: null,
    privateCheckbox: null,
    noHistoryCheckbox: null,
    apiKeyInput: null,
    modelSelect: null,
    modelInfo: null,
    chatContainer: null,
    messageInput: null,
    sendButton: null,
    clearButton: null,
    saveButton: null,
    copyLastButton: null,
    fileButton: null,
    fileInput: null,
    filePreview: null,
    statusText: null,
    modelIndicator: null,
    errorModal: null,
    modalTitle: null,
    modalMessage: null,
    modalRetry: null,
    modalCancel: null
};

// Initialize extension when DOM is loaded
// Кроссбраузерный доступ к хранилищу (Chrome: chrome.storage, Firefox: browser.storage)
const storageAPI = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : chrome.storage;

document.addEventListener('DOMContentLoaded', async function() {
    initializeLanguage();
    initializeElements();
    await initializeSettings();
    await loadChatHistory();
    await loadModels();
    setupEventListeners();
    showStatus(t('ready'));
});

// Initialize language from localStorage
function initializeLanguage() {
    const storedLang = getStoredLanguage();
    currentLanguage = storedLang;
}

// Initialize DOM elements
function initializeElements() {
    elements.languageSelect = document.getElementById('language-select');
    elements.themeSelect = document.getElementById('theme-select');
    elements.settingsButton = document.getElementById('settings-button');
    elements.settingsPanel = document.getElementById('settings-panel');
    elements.closeSettings = document.getElementById('close-settings');
    elements.temperatureSlider = document.getElementById('temperature-slider');
    elements.temperatureValue = document.getElementById('temperature-value');
    elements.privateCheckbox = document.getElementById('private-checkbox');
    elements.noHistoryCheckbox = document.getElementById('no-history-checkbox');
    elements.apiKeyInput = document.getElementById('api-key-input');
    elements.modelSelect = document.getElementById('model-select');
    elements.modelInfo = document.getElementById('model-info');
    elements.chatContainer = document.getElementById('chat-container');
    elements.messageInput = document.getElementById('message-input');
    elements.sendButton = document.getElementById('send-button');
    elements.clearButton = document.getElementById('clear-button');
    elements.saveButton = document.getElementById('save-button');
    elements.copyLastButton = document.getElementById('copy-last-button');
    elements.fileButton = document.getElementById('file-button');
    elements.fileInput = document.getElementById('file-input');
    elements.filePreview = document.getElementById('file-preview');
    elements.statusText = document.getElementById('status-text');
    elements.modelIndicator = document.getElementById('model-indicator');
    elements.errorModal = document.getElementById('error-modal');
    elements.modalTitle = document.getElementById('modal-title');
    elements.modalMessage = document.getElementById('modal-message');
    elements.modalRetry = document.getElementById('modal-retry');
    elements.modalCancel = document.getElementById('modal-cancel');
    
    // Set language selector to current language and update page text
    if (elements.languageSelect) {
        elements.languageSelect.value = currentLanguage;
        updatePageText();
    }
}

// Initialize settings from storage
async function initializeSettings() {
    try {
        const stored = await browser.storage.local.get(['theme', 'temperature', 'private', 'noHistory', 'selectedModel']);
        
        // Apply theme
        const theme = stored.theme || 'dark';
        document.body.setAttribute('data-theme', theme);
        elements.themeSelect.value = theme;
        
        // Apply temperature
        const temperature = stored.temperature !== undefined ? stored.temperature : 0.7;
        elements.temperatureSlider.value = temperature;
        elements.temperatureValue.textContent = temperature;
        
        // Apply private mode
        const isPrivate = stored.private !== undefined ? stored.private : true;
        elements.privateCheckbox.checked = isPrivate;
        
        // Apply no history mode (default false)
        const noHistory = stored.noHistory !== undefined ? stored.noHistory : false;
        elements.noHistoryCheckbox.checked = noHistory;
        
        // Apply API key
        const apiKey = stored.apiKey || '';
        elements.apiKeyInput.value = apiKey;
        
        // Store selected model for later
        window.selectedModel = stored.selectedModel;
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Load chat history from storage
async function loadChatHistory() {
    try {
        const result = await browser.storage.local.get(['conversationHistory', 'chatMessages']);
        
        if (result.conversationHistory) {
            conversationHistory = result.conversationHistory;
        }
        
        if (result.chatMessages) {
            // Restore visual chat messages
            result.chatMessages.forEach(msgData => {
                const messageElement = document.createElement('div');
                messageElement.className = `message ${msgData.type}-message`;
                messageElement.textContent = msgData.text || '';
                elements.chatContainer.appendChild(messageElement);
            });
            
            // Scroll to bottom
            elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
        }
    } catch (error) {
        console.error('Error loading chat history:', error);
    }
}

// Save chat history to storage
async function saveChatHistory() {
    try {
        // Check if history saving is disabled
        if (elements.noHistoryCheckbox.checked) {
            return; // Don't save history if disabled
        }
        
        // Save conversation history for API
        const historyToSave = conversationHistory.slice(); // Copy array
        
        // Save visual messages for UI restoration
        const chatMessages = Array.from(elements.chatContainer.querySelectorAll('.message')).map(msg => ({
            type: msg.classList.contains('user-message') ? 'user' : 
                  msg.classList.contains('bot-message') ? 'bot' : 'error',
            text: msg.textContent || ''
        }));
        
        await browser.storage.local.set({
            conversationHistory: historyToSave,
            chatMessages: chatMessages
        });
    } catch (error) {
        console.error('Error saving chat history:', error);
    }
}

// Clear chat history from storage
async function clearChatHistory() {
    try {
        await browser.storage.local.remove(['conversationHistory', 'chatMessages']);
    } catch (error) {
        console.error('Error clearing chat history:', error);
    }
}

// Load available models from Polination API with 20-second timeout
async function loadModels() {
    // Список моделей кэшируется: без этого панель на каждом открытии ждала
    // ответа сети, прежде чем показать список моделей и дать работать с чатом.
    const MODELS_CACHE_KEY = 'modelsCacheV1';
    const MODELS_CACHE_TTL = 6 * 60 * 60 * 1000;
    try {
        const cachedStore = await storageAPI.local.get(MODELS_CACHE_KEY);
        const cached = cachedStore && cachedStore[MODELS_CACHE_KEY];
        if (cached && cached.models && cached.models.length && (Date.now() - cached.ts) < MODELS_CACHE_TTL) {
            availableModels = cached.models;
            if (typeof textModels !== 'undefined' && cached.text) textModels = cached.text;
            if (typeof imageModels !== 'undefined' && cached.image) imageModels = cached.image;
            populateModelSelect();
            showStatus(t('modelsLoaded'));
            return;
        }
    } catch (e) {}

    try {
        showStatus(t('loadingModelsStatus'));
        
        // Set up 20-second timeout
        const timeoutPromise = new Promise((_, reject) => {
            modelLoadTimeout = setTimeout(() => {
                reject(new Error('Timeout: Models loading took too long'));
            }, 20000); // 20 seconds
        });
        
        const apiKey = elements.apiKeyInput.value.trim();
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        
        const fetchPromise = fetch('https://gen.pollinations.ai/v1/models', {
            headers: headers
        }).then(async response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        });
        
        // Race between fetch and timeout
        availableModels = await Promise.race([fetchPromise, timeoutPromise]);
        
        // Clear timeout if successful
        if (modelLoadTimeout) {
            clearTimeout(modelLoadTimeout);
            modelLoadTimeout = null;
        }
        
        populateModelSelect();
        showStatus(t('modelsLoaded'));
        try {
            storageAPI.local.set({ modelsCacheV1: {
                ts: Date.now(),
                models: availableModels,
                text: (typeof textModels !== 'undefined' ? textModels : null),
                image: (typeof imageModels !== 'undefined' ? imageModels : null)
            } });
        } catch (e) {}
        
    } catch (error) {
        console.error('Error loading models:', error);
        
        // Clear timeout if it exists
        if (modelLoadTimeout) {
            clearTimeout(modelLoadTimeout);
            modelLoadTimeout = null;
        }
        
        if (error.message.includes('Timeout')) {
            // Show timeout error modal
            showTimeoutModal();
        } else {
            showStatus(t('errorLoadingModels'), true);
            // Use fallback models
            loadFallbackModels();
        }
    }
}

// Show timeout error modal
function showTimeoutModal() {
    elements.modalTitle.textContent = t('modelsTimeout');
    elements.modalMessage.textContent = t('modelsTimeoutMessage');
    elements.modalRetry.textContent = t('retryButton');
    elements.modalCancel.textContent = t('cancelButton');
    elements.errorModal.style.display = 'block';
}

// Hide error modal
function hideModal() {
    elements.errorModal.style.display = 'none';
}

// Load fallback models
function loadFallbackModels() {
    availableModels = [
        { name: 'openai', description: 'OpenAI GPT (Default)', vision: true, tools: true },
        { name: 'claude-hybridspace', description: 'Claude (Vision)', vision: true },
        { name: 'openai-large', description: 'OpenAI Large (Vision)', vision: true }
    ];
    populateModelSelect();
}

// Populate model select dropdown
function populateModelSelect() {
    // Clear all options safely
    while (elements.modelSelect.firstChild) {
        elements.modelSelect.removeChild(elements.modelSelect.firstChild);
    }
    
    // Group models by category (translated)
    const categories = {
        [t('recommended')]: [],
        [t('textAndImages')]: [],
        [t('textOnly')]: [],
        [t('audio')]: []
    };
    
    availableModels.forEach(model => {
        if (['openai', 'claude-hybridspace', 'openai-large'].includes(model.name)) {
            categories[t('recommended')].push(model);
        } else if (model.vision) {
            categories[t('textAndImages')].push(model);
        } else if (model.audio) {
            categories[t('audio')].push(model);
        } else {
            categories[t('textOnly')].push(model);
        }
    });
    
    // Add options by category
    Object.entries(categories).forEach(([category, models]) => {
        if (models.length > 0) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = category;
            
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.name;
                option.textContent = `${model.description || model.name}`;
                optgroup.appendChild(option);
            });
            
            elements.modelSelect.appendChild(optgroup);
        }
    });
    
    // Select previously chosen model or default
    if (window.selectedModel && availableModels.some(m => m.name === window.selectedModel)) {
        elements.modelSelect.value = window.selectedModel;
    } else {
        elements.modelSelect.value = 'openai';
    }
    
    updateModelInfo();
}

// Update model info display
function updateModelInfo() {
    const selectedModel = availableModels.find(m => m.name === elements.modelSelect.value);
    if (selectedModel) {
        const features = [];
        if (selectedModel.vision) features.push('👁️ ' + t('images'));
        if (selectedModel.audio) features.push('🎤 ' + t('audioFeature'));
        if (selectedModel.tools) features.push('🛠️ ' + t('functions'));
        if (selectedModel.reasoning) features.push('🧠 ' + t('reasoning'));
        
        const tierInfo = selectedModel.tier ? ` (${selectedModel.tier})` : '';
        elements.modelInfo.textContent = `${features.join(' • ')}${tierInfo}`;
        elements.modelIndicator.textContent = selectedModel.name;
    }
}

// Save settings to storage
async function saveSettings() {
    try {
        const settings = {
            theme: elements.themeSelect.value,
            temperature: parseFloat(elements.temperatureSlider.value),
            private: elements.privateCheckbox.checked,
            noHistory: elements.noHistoryCheckbox.checked,
            apiKey: elements.apiKeyInput.value.trim()
        };
        await browser.storage.local.set(settings);
    } catch (error) {
        console.error('Error saving settings:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    // Language selection
    elements.languageSelect.addEventListener('change', function() {
        const lang = this.value;
        setLanguage(lang);
        populateModelSelect(); // Refresh model categories with new language
        updateModelInfo(); // Update model info with new language
    });
    
    // Theme selection
    elements.themeSelect.addEventListener('change', function() {
        const theme = this.value;
        document.body.setAttribute('data-theme', theme);
        saveSettings();
    });
    
    // Settings panel
    elements.settingsButton.addEventListener('click', function() {
        const isVisible = elements.settingsPanel.style.display !== 'none';
        elements.settingsPanel.style.display = isVisible ? 'none' : 'block';
    });
    
    elements.closeSettings.addEventListener('click', function() {
        elements.settingsPanel.style.display = 'none';
    });
    
    // Temperature slider
    elements.temperatureSlider.addEventListener('input', function() {
        elements.temperatureValue.textContent = this.value;
        saveSettings();
    });
    
    // Private checkbox
    elements.privateCheckbox.addEventListener('change', saveSettings);
    
    // No history checkbox
    elements.noHistoryCheckbox.addEventListener('change', saveSettings);
    
    // API key input
    elements.apiKeyInput.addEventListener('input', saveSettings);
    
    // Model selection
    elements.modelSelect.addEventListener('change', function() {
        updateModelInfo();
        browser.storage.local.set({ selectedModel: this.value });
    });
    
    // Message input and sending
    elements.messageInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });
    
    elements.sendButton.addEventListener('click', sendMessage);
    
    // File upload
    elements.fileButton.addEventListener('click', function() {
        elements.fileInput.click();
    });
    
    elements.fileInput.addEventListener('change', handleFileSelect);
    
    // Action buttons
    elements.clearButton.addEventListener('click', clearChat);
    elements.saveButton.addEventListener('click', saveChat);
    elements.copyLastButton.addEventListener('click', copyLastResponse);
    
    // Modal event listeners
    elements.modalRetry.addEventListener('click', async function() {
        hideModal();
        await loadModels();
    });
    
    elements.modalCancel.addEventListener('click', function() {
        hideModal();
        loadFallbackModels();
        showStatus(t('errorLoadingModels'), true);
    });
    
    // Close modal when clicking outside
    elements.errorModal.addEventListener('click', function(event) {
        if (event.target === elements.errorModal) {
            hideModal();
            loadFallbackModels();
            showStatus(t('errorLoadingModels'), true);
        }
    });
}

// Handle file selection
function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    
    files.forEach(file => {
        if (currentFiles.length >= 10) {
            showStatus(t('maxFiles'), true);
            return;
        }
        
        if (file.size > 10 * 1024 * 1024) { // 10MB limit
            showStatus(t('fileTooLarge', { filename: file.name }), true);
            return;
        }
        
        currentFiles.push(file);
    });
    
    updateFilePreview();
    elements.fileInput.value = '';
}

// Update file preview
function updateFilePreview() {
    // Clear all file preview items safely
    while (elements.filePreview.firstChild) {
        elements.filePreview.removeChild(elements.filePreview.firstChild);
    }
    
    currentFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-preview-item';
        
        const icon = getFileIcon(file.type);
        const name = file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name;
        
        // Create span element safely
        const span = document.createElement('span');
        span.textContent = `${icon} ${name}`;
        
        // Create remove button safely
        const removeButton = document.createElement('button');
        removeButton.className = 'remove-file';
        removeButton.textContent = '×';
        removeButton.addEventListener('click', () => removeFile(index));
        
        item.appendChild(span);
        item.appendChild(removeButton);
        
        elements.filePreview.appendChild(item);
    });
}

// Remove file from current files
function removeFile(index) {
    currentFiles.splice(index, 1);
    updateFilePreview();
}

// Get file icon based on type
function getFileIcon(type) {
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('audio/')) return '🎵';
    if (type.includes('pdf')) return '📄';
    if (type.includes('text') || type.includes('json') || type.includes('javascript')) return '📝';
    return '📎';
}

// Send message to API
async function sendMessage() {
    const message = elements.messageInput.value.trim();
    
    if (!message && currentFiles.length === 0) {
        showStatus(t('enterMessage'), true);
        return;
    }
    
    const selectedModel = elements.modelSelect.value;
    if (!selectedModel) {
        showStatus(t('selectModel'), true);
        return;
    }
    
    // Check for generation commands
    if (message.startsWith('/image ')) {
        await generateImage(message.slice(7));
        elements.messageInput.value = '';
        return;
    } else if (message.startsWith('/audio ')) {
        await generateAudio(message.slice(7));
        elements.messageInput.value = '';
        return;
    } else if (message.startsWith('/video ')) {
        await generateVideo(message.slice(8));
        elements.messageInput.value = '';
        return;
    }
    
    // Disable send button
    elements.sendButton.disabled = true;
    elements.messageInput.disabled = true;
    
    try {
        // Add user message to chat
        if (message) {
            addMessage(message, 'user', currentFiles.slice());
        }
        
        // Prepare message for API
        const messages = await prepareMessages(message);
        
        // Clear input and files
        elements.messageInput.value = '';
        currentFiles = [];
        updateFilePreview();
        
        showStatus(t('sendingRequest'));
        
        // Send to Polination API
        await sendToPolination(messages, selectedModel);
        
    } catch (error) {
        console.error('Error sending message:', error);
        addMessage(t('errorSendingMessage') + error.message, 'error');
        showStatus(t('sendError'), true);
    } finally {
        // Re-enable controls
        elements.sendButton.disabled = false;
        elements.messageInput.disabled = false;
        elements.messageInput.focus();
    }
}

// Prepare messages for API call
async function prepareMessages(userMessage) {
    const messages = [...conversationHistory];
    
    if (userMessage || currentFiles.length > 0) {
        let content = userMessage || '';
        
        // Add file content for text files
        for (const file of currentFiles) {
            try {
                if (file.type.startsWith('text/') || file.name.endsWith('.json') || file.name.endsWith('.md') || file.name.endsWith('.js') || file.name.endsWith('.py')) {
                    const text = await fileToText(file);
                    content += `\n\n${t('fileContent', { filename: file.name })}\n\n${text}`;
                } else if (file.type.startsWith('image/')) {
                    content += `\n\n[${t('imageFile', { filename: file.name })}]`;
                }
            } catch (error) {
                console.error('Error processing file:', file.name, error);
            }
        }
        
        messages.push({
            role: 'user',
            content: content.trim()
        });
    }
    
    return messages;
}

// Send request to Polination API
async function sendToPolination(messages, model) {
    const temperature = parseFloat(elements.temperatureSlider.value);
    const isPrivate = elements.privateCheckbox.checked;
    const apiKey = elements.apiKeyInput.value.trim();
    
    if (!apiKey) {
        throw new Error('API key is required. Please enter your Pollinations API key in settings.');
    }
    
    const requestBody = {
        model: model,
        messages: messages,
        temperature: temperature,
        stream: true,
        private: isPrivate
    };
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };
    
    const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    
    // Create message element for streaming
    const messageElement = addMessage('', 'bot');
    messageElement.classList.add('streaming');
    
    showStatus(t('receivingResponse'));
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    
                    if (data === '[DONE]') {
                        break;
                    }
                    
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                            const content = parsed.choices[0].delta.content;
                            if (content) {
                                fullResponse += content;
                                updateMessageContent(messageElement, fullResponse);
                            }
                        }
                    } catch (parseError) {
                        // Ignore parsing errors for streaming
                    }
                }
            }
        }
    } catch (streamError) {
        console.error('Streaming error:', streamError);
        if (!fullResponse) {
            throw streamError;
        }
    }
    
    // Update conversation history
    conversationHistory.push(...messages);
    if (fullResponse) {
        conversationHistory.push({
            role: 'assistant',
            content: fullResponse
        });
    }
    
    // Remove streaming indicator
    messageElement.classList.remove('streaming');
    
    // Save chat history after receiving response
    await saveChatHistory();
    
    showStatus(t('responseReceived'));
}

// Generate image
async function generateImage(prompt) {
    const apiKey = elements.apiKeyInput.value.trim();
    if (!apiKey) {
        addMessage('Error: API key is required.', 'error');
        return;
    }
    
    addMessage(`Generating image: ${prompt}`, 'user');
    showStatus(t('generatingImage'));
    
    try {
        const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=flux&private=true`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        const messageElement = addMessage('', 'bot');
        const img = document.createElement('img');
        img.src = imageUrl;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        messageElement.appendChild(img);
        
        await saveChatHistory();
        showStatus(t('imageGenerated'));
    } catch (error) {
        console.error('Error generating image:', error);
        addMessage('Error generating image: ' + error.message, 'error');
        showStatus(t('generationFailed'), true);
    }
}

// Generate audio
async function generateAudio(prompt) {
    const apiKey = elements.apiKeyInput.value.trim();
    if (!apiKey) {
        addMessage('Error: API key is required.', 'error');
        return;
    }
    
    addMessage(`Generating audio: ${prompt}`, 'user');
    showStatus(t('generatingAudio'));
    
    try {
        const messages = [{ role: 'user', content: prompt }];
        const requestBody = {
            model: 'openai',
            messages: messages,
            modalities: ['audio'],
            audio: { voice: 'alloy', format: 'wav' },
            private: true
        };
        
        const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.audio) {
            const audioData = data.choices[0].message.audio.data;
            const audioBlob = new Blob([Uint8Array.from(atob(audioData), c => c.charCodeAt(0))], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(audioBlob);
            
            const messageElement = addMessage('', 'bot');
            const audio = document.createElement('audio');
            audio.src = audioUrl;
            audio.controls = true;
            messageElement.appendChild(audio);
        } else {
            throw new Error('No audio in response');
        }
        
        await saveChatHistory();
        showStatus(t('audioGenerated'));
    } catch (error) {
        console.error('Error generating audio:', error);
        addMessage('Error generating audio: ' + error.message, 'error');
        showStatus(t('generationFailed'), true);
    }
}

// Generate video
async function generateVideo(prompt) {
    const apiKey = elements.apiKeyInput.value.trim();
    if (!apiKey) {
        addMessage('Error: API key is required.', 'error');
        return;
    }
    
    addMessage(`Generating video: ${prompt}`, 'user');
    showStatus(t('generatingVideo'));
    
    try {
        const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=veo&duration=4&private=true`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        const videoUrl = URL.createObjectURL(blob);
        
        const messageElement = addMessage('', 'bot');
        const video = document.createElement('video');
        video.src = videoUrl;
        video.controls = true;
        video.style.maxWidth = '100%';
        messageElement.appendChild(video);
        
        await saveChatHistory();
        showStatus(t('videoGenerated'));
    } catch (error) {
        console.error('Error generating video:', error);
        addMessage('Error generating video: ' + error.message, 'error');
        showStatus(t('generationFailed'), true);
    }
}

// Add message to chat
function addMessage(content, type, files = []) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}-message`;
    
    // Add file attachments if any
    if (files.length > 0) {
        const attachmentsDiv = document.createElement('div');
        files.forEach(file => {
            const attachment = document.createElement('div');
            attachment.className = 'file-attachment';
            
            if (file.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.className = 'attachment-image';
                img.src = URL.createObjectURL(file);
                img.alt = file.name;
                attachment.appendChild(img);
            } else {
                attachment.textContent = `${getFileIcon(file.type)} ${file.name}`;
            }
            
            attachmentsDiv.appendChild(attachment);
        });
        messageElement.appendChild(attachmentsDiv);
    }
    
    // Add text content
    if (content) {
        const textDiv = document.createElement('div');
        textDiv.textContent = content;
        messageElement.appendChild(textDiv);
    }
    
    elements.chatContainer.appendChild(messageElement);
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
    
    return messageElement;
}

// Update message content (for streaming)
function updateMessageContent(messageElement, content) {
    const textDiv = messageElement.querySelector('div:last-child') || document.createElement('div');
    textDiv.textContent = content;
    
    if (!messageElement.contains(textDiv)) {
        messageElement.appendChild(textDiv);
    }
    
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// Clear chat
async function clearChat() {
    if (confirm(t('confirmClearChat'))) {
        // Clear chat container safely
        while (elements.chatContainer.firstChild) {
            elements.chatContainer.removeChild(elements.chatContainer.firstChild);
        }
        conversationHistory = [];
        await clearChatHistory(); // Clear from storage
        showStatus(t('chatCleared'));
    }
}

// Save chat to file
function saveChat() {
    const messages = Array.from(elements.chatContainer.querySelectorAll('.message'));
    let chatText = `Polination AI Chat - ${new Date().toLocaleString()}\n\n`;
    
    messages.forEach(message => {
        const type = message.classList.contains('user-message') ? t('user') : t('ai');
        const content = message.textContent || '';
        chatText += `${type}: ${content}\n\n`;
    });
    
    downloadTextFile(chatText, `polination-chat-${Date.now()}.txt`);
    showStatus(t('chatSaved'));
}

// Copy last AI response
function copyLastResponse() {
    const botMessages = elements.chatContainer.querySelectorAll('.bot-message');
    if (botMessages.length > 0) {
        const lastMessage = botMessages[botMessages.length - 1];
        const text = lastMessage.textContent || '';
        
        navigator.clipboard.writeText(text).then(() => {
            showStatus(t('responseCopied'));
        }).catch(error => {
            console.error('Copy failed:', error);
            showStatus(t('copyError'), true);
        });
    } else {
        showStatus(t('noResponsesToCopy'), true);
    }
}

// Utility functions

// Convert file to base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Convert file to text
function fileToText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

// Download text as file
function downloadTextFile(text, filename) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Show status message
function showStatus(message, isError = false) {
    elements.statusText.textContent = message;
    elements.statusText.style.color = isError ? 'var(--error-color)' : 'var(--text-secondary)';
    
    if (isError) {
        setTimeout(() => {
            elements.statusText.textContent = t('ready');
            elements.statusText.style.color = 'var(--text-secondary)';
        }, 3000);
    }
}

// Make removeFile function global for HTML onclick
window.removeFile = removeFile;
