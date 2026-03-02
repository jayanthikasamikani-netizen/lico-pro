import React, { useState, useRef, useEffect } from "react";
import { 
  Send, 
  Image as ImageIcon, 
  Upload, 
  Sparkles, 
  Trash2, 
  Download, 
  Loader2, 
  Plus, 
  Search,
  MessageSquare,
  X,
  Maximize2,
  Edit3,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  ExternalLink
} from "lucide-react";

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
import { motion, AnimatePresence } from "motion/react";
import { useDropzone } from "react-dropzone";
import ReactMarkdown from "react-markdown";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { 
  generateImage, 
  editImage, 
  chatWithAI, 
  analyzeImage, 
  generateSpeech,
  generateVideo,
  Message 
} from "./services/geminiService";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "generate" | "edit" | "analyze">("chat");
  const [isListening, setIsListening] = useState(false);
  const [isTranslatingVoice, setIsTranslatingVoice] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      } else {
        setHasApiKey(true); // Fallback for environments without the selection tool
      }
    };
    checkApiKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true); // Proceed as if successful per guidelines
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = ''; // Let browser auto-detect or use system default

      recognitionRef.current.onresult = async (event: any) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        
        setInput(transcript);

        if (event.results[event.results.length - 1].isFinal) {
          setIsListening(false);
          setIsTranslatingVoice(true);
          try {
            // Use Gemini to translate the transcript to Sinhala/English automatically
            const response = await chatWithAI(`Translate the following text to Sinhala if it's in another language, or keep it as is if it's already Sinhala or English. Return ONLY the translated/processed text: "${transcript}"`, []);
            setInput(response.text?.trim() || transcript);
          } catch (error) {
            console.error("Translation error:", error);
          } finally {
            setIsTranslatingVoice(false);
          }
        }
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const onDrop = (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedImage(e.target?.result as string);
        if (mode === "chat") setMode("analyze");
      };
      reader.readAsDataURL(file);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    multiple: false,
  });

  const handleSend = async () => {
    if (!input.trim() && !uploadedImage) return;

    const currentInput = input;
    const currentUserMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: currentInput,
      type: uploadedImage ? "analysis" : "text",
      imageUrl: uploadedImage || undefined,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, currentUserMessage]);
    setInput("");
    setIsLoading(true);
    setProgress(0);

    try {
      let assistantResponse = "";
      let responseType: Message["type"] = "text";
      let responseImageUrl: string | undefined;
      let responseVideoUrl: string | undefined;
      let groundingLinks: { title: string; url: string }[] = [];

      if (mode === "generate") {
        const imageUrl = await generateImage(currentInput, (p) => setProgress(p));
        assistantResponse = `Generated image for: "${currentInput}"`;
        responseType = "image";
        responseImageUrl = imageUrl;
      } else if (mode === "edit" && uploadedImage) {
        const imageUrl = await editImage(uploadedImage, currentInput);
        assistantResponse = `Edited image based on: "${currentInput}"`;
        responseType = "image";
        responseImageUrl = imageUrl;
        setUploadedImage(null);
      } else if (mode === "analyze" && uploadedImage) {
        const analysis = await analyzeImage(uploadedImage, currentInput || "Analyze this image.");
        assistantResponse = analysis;
        responseType = "analysis";
        setUploadedImage(null);
      } else {
        const response = await chatWithAI(currentInput, messages, uploadedImage || undefined);
        assistantResponse = response.text || "I'm sorry, I couldn't process that.";
        
        if (uploadedImage) {
          setUploadedImage(null);
        }
        
        // Extract grounding links (video links)
        if (response.groundingChunks) {
          groundingLinks = response.groundingChunks
            .filter((chunk: any) => chunk.web)
            .map((chunk: any) => ({
              title: chunk.web.title,
              url: chunk.web.uri
            }));
        }
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: assistantResponse,
        type: responseType,
        imageUrl: responseImageUrl,
        videoUrl: responseVideoUrl,
        groundingLinks: groundingLinks.length > 0 ? groundingLinks : undefined,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error: any) {
      console.error("Error:", error);
      
      let errorContent = "I encountered an error while processing your request. Please try again.";
      
      // Check for permission errors (403) or missing key errors
      const errorString = JSON.stringify(error).toLowerCase();
      if (errorString.includes("permission") || errorString.includes("403") || errorString.includes("not found")) {
        errorContent = "It looks like there's a problem with your API key or permissions. Please click 'Connect API Key' in the header and make sure you've selected a valid key from a paid Google Cloud project. 🔑";
        setHasApiKey(false); // Reset key state to show the button
      }

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: errorContent,
        type: "text",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setUploadedImage(null);
  };

  const downloadSetup = () => {
    const appUrl = window.location.href;
    const content = `[InternetShortcut]\nURL=${appUrl}\nIconIndex=0`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Lico-AI-Desktop.url";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Also show a helpful message
    const setupMessage: Message = {
      id: Date.now().toString(),
      role: "assistant",
      content: "Lico AI Setup file එක download වුණා! 📥\n\nමේ file එක ඔයාගේ Desktop එකට දාගන්න. එතකොට හැමතිස්සෙම ලේසියෙන්ම Lico AI පාවිච්චි කරන්න පුළුවන්. PC එකේ install කරන්න වෙනම setup එකක් අවශ්‍ය නැහැ, මේක Cloud AI එකක් නිසා කෙලින්ම වැඩ කරනවා! 🚀✨",
      type: "text",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, setupMessage]);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white text-black">
      {/* Main Content */}
      <main className="relative flex flex-1 flex-col overflow-hidden bg-white">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-gray-100 px-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#10a37f]">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <h1 className="font-serif text-xl font-bold tracking-tight">Lico AI</h1>
            </div>
            {hasApiKey === false && (
              <button 
                onClick={handleSelectKey}
                className="flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-200"
              >
                <Plus className="h-3 w-3" />
                Connect API Key
              </button>
            )}
            <button 
              onClick={downloadSetup}
              className="flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-200"
            >
              <Download className="h-3 w-3" />
              Download Setup
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setMode("chat")}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-all",
                mode === "chat" ? "bg-black text-white" : "hover:bg-gray-100"
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
            </button>
            <button 
              onClick={() => setMode("generate")}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-all",
                mode === "generate" ? "bg-black text-white" : "hover:bg-gray-100"
              )}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Image
            </button>
          </div>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="mx-auto max-w-6xl space-y-8 pb-24">
            {messages.length === 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-20 text-center"
              >
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
                  <Sparkles className="h-8 w-8" />
                </div>
                <h2 className="font-serif text-4xl font-bold tracking-tight mb-4 text-gray-900">Lico AI</h2>
                <p className="max-w-md text-gray-500">
                  I can generate stunning images, analyze content, or chat in Sinhala or English.
                </p>
              </motion.div>
            )}

            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex w-full gap-4",
                  message.role === "user" ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  message.role === "user" ? "bg-gray-100" : "bg-[#10a37f]"
                )}>
                  {message.role === "user" ? <div className="h-4 w-4 rounded-full bg-gray-400" /> : <Sparkles className="h-4 w-4 text-white" />}
                </div>
                
                <div className={cn(
                  "flex max-w-[90%] flex-col gap-2",
                  message.role === "user" ? "items-end" : "items-start"
                )}>
                  <div className={cn(
                    "rounded-2xl px-4 py-3 text-sm",
                    message.role === "user" 
                      ? "bg-gray-100 text-gray-900" 
                      : "text-gray-800"
                  )}>
                    {message.imageUrl && (
                      <div className="mb-3 overflow-hidden rounded-xl border border-gray-200">
                        <img 
                          src={message.imageUrl} 
                          alt="User upload" 
                          className="max-h-96 w-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    
                    {message.type === "image" && message.imageUrl ? (
                      <div className="relative group">
                        <img 
                          src={message.imageUrl} 
                          alt="Generated" 
                          className="max-h-96 w-full rounded-xl object-contain cursor-zoom-in"
                          onClick={() => setSelectedImage(message.imageUrl!)}
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : message.type === "video" && message.videoUrl ? (
                      <div className="overflow-hidden rounded-xl border border-gray-200">
                        <video 
                          src={message.videoUrl} 
                          controls 
                          className="max-h-96 w-full"
                        />
                      </div>
                    ) : (
                      <div className="markdown-body">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    )}

                    {message.groundingLinks && (
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                        {message.groundingLinks.map((link, idx) => (
                          <a 
                            key={idx}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1 text-[10px] font-medium text-emerald-600 hover:bg-emerald-50"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {link.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </motion.div>
            ))}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex w-full gap-4 flex-row"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#10a37f]">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div className="flex flex-col gap-2 items-start">
                  <div className="rounded-2xl px-4 py-3 text-sm text-gray-800 bg-gray-50 flex items-center gap-3 shadow-sm border border-emerald-50">
                    <div className="relative">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600 [animation-duration:0.3s]" />
                      <div className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20 [animation-duration:0.5s]" />
                    </div>
                    <span className="text-xs font-medium text-gray-400 animate-pulse">
                      MAX Speed Lico හිතනවා... {progress > 0 && `[${progress}%]`}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 w-full p-6 bg-gradient-to-t from-white via-white to-transparent">
          <div className="mx-auto max-w-6xl">
            <div className="relative rounded-3xl border border-gray-200 bg-white p-2 shadow-xl">
              {/* Upload Preview */}
              <AnimatePresence>
                {uploadedImage && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mb-2 overflow-hidden px-4 pt-4"
                  >
                    <div className="relative inline-block">
                      <img 
                        src={uploadedImage} 
                        alt="Preview" 
                        className="h-24 w-24 rounded-xl object-cover border border-gray-200"
                        referrerPolicy="no-referrer"
                      />
                      <button 
                        onClick={() => setUploadedImage(null)}
                        className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white shadow-lg"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-end gap-2 px-2 pb-2">
                <div className="flex gap-1">
                  <div {...getRootProps()} className="cursor-pointer">
                    <input {...getInputProps()} />
                    <button className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-2xl transition-all hover:bg-gray-100",
                      isDragActive ? "bg-emerald-100 text-emerald-600" : "text-gray-400"
                    )}>
                      <Upload className="h-5 w-5" />
                    </button>
                  </div>
                  <button 
                    onClick={() => setMode(mode === "generate" ? "chat" : "generate")}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-2xl transition-all hover:bg-gray-100",
                      mode === "generate" ? "text-emerald-600" : "text-gray-400"
                    )}
                  >
                    <ImageIcon className="h-5 w-5" />
                  </button>
                  <button 
                    onClick={toggleListening}
                    disabled={isTranslatingVoice}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-2xl transition-all hover:bg-gray-100",
                      isListening ? "bg-red-100 text-red-600 animate-pulse" : 
                      isTranslatingVoice ? "bg-emerald-100 text-emerald-600" : "text-gray-400"
                    )}
                  >
                    {isListening ? <MicOff className="h-5 w-5" /> : 
                     isTranslatingVoice ? <Loader2 className="h-5 w-5 animate-spin" /> : 
                     <Mic className="h-5 w-5" />}
                  </button>
                </div>

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={
                    mode === "generate" 
                      ? "Describe the image you want to create..." 
                      : "Ask Lico anything (English or Sinhala)..."
                  }
                  className="flex-1 resize-none bg-transparent px-2 py-3 text-sm outline-none placeholder:text-gray-300"
                  rows={1}
                  style={{ minHeight: "44px", maxHeight: "200px" }}
                />

                <button
                  onClick={handleSend}
                  disabled={isLoading || (!input.trim() && !uploadedImage)}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-2xl transition-all",
                    isLoading || (!input.trim() && !uploadedImage)
                      ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                      : "bg-black text-white hover:scale-105 active:scale-95"
                  )}
                >
                  {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <p className="mt-3 text-center text-[10px] text-gray-400">
              Lico AI can make mistakes. Powered by Gemini.
            </p>
          </div>
        </div>
      </main>

      {/* Image Modal */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-xl"
            onClick={() => setSelectedImage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-h-full max-w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                src={selectedImage} 
                alt="Full size" 
                className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
                referrerPolicy="no-referrer"
              />
              <div className="absolute -right-4 -top-4 flex gap-2">
                <button 
                  onClick={() => setSelectedImage(null)}
                  className="rounded-full bg-white/10 p-2 text-white backdrop-blur-md hover:bg-white/20"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
