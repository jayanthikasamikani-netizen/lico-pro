import { GoogleGenAI, Modality, Type, GenerateContentResponse, ThinkingLevel } from "@google/genai";

const getAI = () => {
  const key = process.env.GEMINI_API_KEY || "";
  return new GoogleGenAI({ apiKey: key });
};

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  type: "text" | "image" | "analysis" | "video";
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  timestamp: Date;
  groundingLinks?: { title: string; url: string }[];
}

export const generateImage = async (prompt: string, onProgress?: (percent: number) => void, aspectRatio: "1:1" | "16:9" | "9:16" = "1:1") => {
  if (onProgress) onProgress(10);
  
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio,
      },
    },
  });

  if (onProgress) onProgress(100);

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("No image generated");
};

export const editImage = async (base64Image: string, prompt: string) => {
  const matches = base64Image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (!matches) throw new Error("Invalid image format");
  
  const mimeType = matches[1];
  const data = matches[2];

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [
        {
          inlineData: {
            data,
            mimeType,
          },
        },
        { text: prompt },
      ],
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("No edited image generated");
};

export const chatWithAI = async (message: string, history: Message[] = [], imageData?: string) => {
  const ai = getAI();
  
  const contents: any[] = history.map(m => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }]
  })).slice(-10);

  // Add the current message with image if provided
  const currentPart: any[] = [];
  if (imageData) {
    const [mimeType, data] = imageData.split(";base64,");
    currentPart.push({
      inlineData: {
        data,
        mimeType: mimeType.split(":")[1],
      },
    });
  }
  currentPart.push({ text: message });

  const chat = ai.chats.create({
    model: "gemini-flash-lite-latest",
    config: {
      systemInstruction: "You are Lico AI, a highly intelligent, empathetic, and helpful assistant with an 'explosive' (pupiri) brain. You understand human emotions deeply and respond with care and kindness. If the user is sad or sharing their feelings, provide comfort and support in a human-like way. If the user speaks in Sinhala, respond in fluent Sinhala. Use relevant emojis in your responses to make them friendly and expressive. If the user asks for a video (e.g., a funny YouTube video), use the googleSearch tool to find relevant YouTube links and include them in your response. Note: You do not record or store user data for privacy.",
      tools: [{ googleSearch: {} }],
    },
    history: contents,
  });

  const response = await chat.sendMessage({ message: currentPart });
  return {
    text: response.text,
    groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks
  };
};

export const generateVideo = async (prompt: string, onProgress?: (percent: number) => void) => {
  // Step 1: Generate initial video (usually 5s)
  if (onProgress) onProgress(5);
  
  const ai = getAI();
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: prompt,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    }
  });

  let progress = 5;
  while (!operation.done) {
    if (onProgress && progress < 45) {
      progress += 5;
      onProgress(progress);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  if (onProgress) onProgress(50);

  const initialVideo = operation.response?.generatedVideos?.[0]?.video;
  if (!initialVideo) throw new Error("Video generation failed");

  // Step 2: Extend video to reach 8s+ (adding 7s makes it ~12s)
  // Re-initialize AI to ensure fresh key if needed
  const ai2 = getAI();
  let extendOperation = await ai2.models.generateVideos({
    model: 'veo-3.1-generate-preview',
    prompt: "continue the scene naturally",
    video: initialVideo,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    }
  });

  progress = 50;
  while (!extendOperation.done) {
    if (onProgress && progress < 95) {
      progress += 5;
      onProgress(progress);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
    extendOperation = await ai2.operations.getVideosOperation({ operation: extendOperation });
  }

  if (onProgress) onProgress(100);

  const finalVideoUri = extendOperation.response?.generatedVideos?.[0]?.video?.uri;
  return finalVideoUri;
};

export const generateSpeech = async (text: string) => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      // The Gemini TTS API returns raw PCM data (16-bit, 24kHz, mono).
      // We need to wrap it in a WAV header so the <audio> tag can play it.
      const pcmData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
      const wavHeader = createWavHeader(pcmData.length, 24000);
      const wavData = new Uint8Array(wavHeader.length + pcmData.length);
      wavData.set(wavHeader);
      wavData.set(pcmData, wavHeader.length);
      
      const base64Wav = btoa(String.fromCharCode(...wavData));
      return `data:audio/wav;base64,${base64Wav}`;
    }
  } catch (error) {
    console.error("TTS Error:", error);
  }
  return null;
};

// Helper to create a WAV header for mono 16-bit PCM
function createWavHeader(dataLength: number, sampleRate: number) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // RIFF chunk length
  view.setUint32(4, 36 + dataLength, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 is PCM)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * channelCount * bitsPerSample/8)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channelCount * bitsPerSample/8)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, dataLength, true);

  return new Uint8Array(header);
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export const analyzeImage = async (base64Image: string, prompt: string = "Analyze this image in detail.") => {
  const matches = base64Image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (!matches) throw new Error("Invalid image format");
  
  const mimeType = matches[1];
  const data = matches[2];

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: {
      parts: [
        {
          inlineData: {
            data,
            mimeType,
          },
        },
        { text: prompt },
      ],
    },
  });

  return response.text;
};
