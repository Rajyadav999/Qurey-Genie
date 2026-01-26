import { useState, useRef, useEffect } from 'react';
import { Send, Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  isConnected: boolean;
  onOpenModal: () => void;
}

const ChatInput = ({ onSend, isLoading, isConnected, onOpenModal }: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [gradientIndex, setGradientIndex] = useState(0);
  const [animationSpeed, setAnimationSpeed] = useState(3);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastKeypressTime = useRef<number>(Date.now());
  const typingSpeedTimeout = useRef<NodeJS.Timeout | null>(null);

  // Premium gradient combinations - CSS gradient strings
  const gradientThemes = [
    'linear-gradient(90deg, #a855f7, #ec4899, #f43f5e)',
    'linear-gradient(90deg, #3b82f6, #06b6d4, #14b8a6)',
    'linear-gradient(90deg, #8b5cf6, #a855f7, #d946ef)',
    'linear-gradient(90deg, #06b6d4, #3b82f6, #6366f1)',
    'linear-gradient(90deg, #ec4899, #f43f5e, #f97316)',
    'linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7)',
    'linear-gradient(90deg, #10b981, #14b8a6, #06b6d4)',
    'linear-gradient(90deg, #d946ef, #ec4899, #f43f5e)',
    'linear-gradient(90deg, #f59e0b, #f97316, #f43f5e)',
    'linear-gradient(90deg, #3b82f6, #6366f1, #8b5cf6)',
    'linear-gradient(90deg, #f43f5e, #fb923c, #fbbf24)',
    'linear-gradient(90deg, #14b8a6, #06b6d4, #0ea5e9)',
    'linear-gradient(90deg, #a855f7, #d946ef, #ec4899)',
    'linear-gradient(90deg, #6366f1, #8b5cf6, #d946ef)',
    'linear-gradient(90deg, #059669, #10b981, #34d399)',
  ];

  // Tailwind gradient classes for button
  const gradientClassThemes = [
    'from-purple-500 via-pink-500 to-rose-500',
    'from-blue-500 via-cyan-500 to-teal-500',
    'from-violet-500 via-purple-500 to-fuchsia-500',
    'from-cyan-500 via-blue-500 to-indigo-500',
    'from-pink-500 via-rose-500 to-orange-500',
    'from-indigo-500 via-violet-500 to-purple-500',
    'from-emerald-500 via-teal-500 to-cyan-500',
    'from-fuchsia-500 via-pink-500 to-rose-500',
    'from-amber-500 via-orange-500 to-rose-500',
    'from-blue-500 via-indigo-500 to-violet-500',
    'from-rose-500 via-orange-500 to-amber-500',
    'from-teal-500 via-cyan-500 to-sky-500',
    'from-purple-500 via-fuchsia-500 to-pink-500',
    'from-indigo-500 via-violet-500 to-fuchsia-500',
    'from-green-600 via-emerald-500 to-teal-400',
  ];

  // Auto-resize textarea
  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [message]);

  // Calculate typing speed and adjust animation
  const calculateTypingSpeed = () => {
    const currentTime = Date.now();
    const timeDiff = currentTime - lastKeypressTime.current;
    lastKeypressTime.current = currentTime;

    let newSpeed: number;
    
    if (timeDiff < 100) {
      newSpeed = 0.8;
    } else if (timeDiff < 200) {
      newSpeed = 1.2;
    } else if (timeDiff < 300) {
      newSpeed = 2;
    } else if (timeDiff < 500) {
      newSpeed = 3;
    } else {
      newSpeed = 4;
    }

    setAnimationSpeed(newSpeed);

    if (typingSpeedTimeout.current) {
      clearTimeout(typingSpeedTimeout.current);
    }
    
    typingSpeedTimeout.current = setTimeout(() => {
      setAnimationSpeed(3);
    }, 1000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmedMessage = message.trim();
    if (!trimmedMessage || isLoading) return;

    onSend(trimmedMessage);
    setMessage('');
    setAnimationSpeed(3);
    
    if (textareaRef.current) {
      textareaRef.current.style.height = '56px';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const oldLength = message.length;
    const newLength = newValue.length;
    
    setMessage(newValue);
    
    // Only trigger gradient on letters and spaces
    if (newLength > oldLength) {
      const lastChar = newValue[newLength - 1];
      // Check if the last character is a letter or space
      if (/[a-zA-Z\s]/.test(lastChar)) {
        setGradientIndex((prev) => (prev + 1) % gradientThemes.length);
        calculateTypingSpeed();
      }
    }
  };

  useEffect(() => {
    return () => {
      if (typingSpeedTimeout.current) {
        clearTimeout(typingSpeedTimeout.current);
      }
    };
  }, []);

  const showGradientBorder = message.length > 0;

  return (
    <>
      {/* CSS Animations */}
      <style>{`
        @keyframes gradient-shift {
          0%, 100% {
            background-position: 0% 50%;
          }
          25% {
            background-position: 100% 50%;
          }
          50% {
            background-position: 200% 50%;
          }
          75% {
            background-position: 100% 50%;
          }
        }

        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: none;
          }
          50% {
            box-shadow: none;
          }
        }

        @keyframes pulse-glow-fast {
          0%, 100% {
            box-shadow: none;
          }
          50% {
            box-shadow: none;
          }
        }

        .gradient-border-active {
          position: relative;
          background: linear-gradient(white, white) padding-box,
                      var(--gradient-border) border-box;
          border: 3px solid transparent;
          background-size: 200% 200%;
          background-origin: border-box;
          background-clip: padding-box, border-box;
        }

        /* Custom scrollbar */
        textarea::-webkit-scrollbar {
          width: 6px;
        }

        textarea::-webkit-scrollbar-track {
          background: transparent;
        }

        textarea::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 3px;
        }

        textarea::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>

      <div className="bg-white px-4 py-6">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          {/* Main input container with gradient border */}
          <div 
            className={`
              relative rounded-2xl transition-all duration-300 ease-out bg-white
              ${showGradientBorder
                ? 'gradient-border-active' 
                : isFocused
                ? 'ring-2 ring-gray-200' 
                : 'ring-1 ring-gray-200'
              }
            `}
            style={{
              ...(showGradientBorder && {
                '--gradient-border': gradientThemes[gradientIndex],
                animation: `gradient-shift ${animationSpeed}s ease infinite, ${animationSpeed < 1.5 ? 'pulse-glow-fast' : 'pulse-glow'} ${animationSpeed}s ease-in-out infinite`,
                color: gradientThemes[gradientIndex].match(/#[a-fA-F0-9]{6}/)?.[0] || '#a855f7',
              } as React.CSSProperties),
            }}
          >
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={
                isConnected 
                  ? "Ask Query Genie anything about your data..." 
                  : "Connect to a database to start querying..."
              }
              className={`
                w-full min-h-[56px] max-h-[200px] resize-none 
                px-5 py-4 pr-28 
                bg-transparent border-0 rounded-2xl 
                focus:outline-none focus:ring-0 
                text-[15px] leading-relaxed text-gray-900 
                placeholder:text-gray-400 placeholder:font-normal
                overflow-y-auto
                font-[system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI','Inter',sans-serif]
                transition-all duration-200
              `}
              disabled={isLoading}
              rows={1}
              style={{ 
                height: '56px',
                lineHeight: '1.6',
              }}
            />
            
            {/* Action Buttons */}
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              {!isConnected && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 hover:bg-gray-100 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95"
                  onClick={onOpenModal}
                  disabled={isLoading}
                  title="Connect to database"
                >
                  <Database size={18} className="text-gray-600" />
                </Button>
              )}
              <Button
                type="submit"
                size="icon"
                className={`
                  h-9 w-9 rounded-xl transition-all duration-300 relative overflow-hidden
                  ${message.trim() && !isLoading
                    ? `bg-gradient-to-r ${gradientClassThemes[gradientIndex]} hover:scale-105 active:scale-95` 
                    : 'bg-gray-200 cursor-not-allowed opacity-60'
                  }
                `}
                disabled={!message.trim() || isLoading}
                title="Send message"
              >
                {isLoading ? (
                  <Loader2 size={18} className="animate-spin text-white relative z-10" />
                ) : (
                  <Send size={18} className="text-white relative z-10" />
                )}
              </Button>
            </div>
          </div>
          
          {/* Helper Text */}
          <div className="flex items-center justify-center mt-4 px-4">
            <p className="text-[13px] text-gray-500 font-medium">
              {isConnected ? (
                <span className="inline-flex items-center gap-2">
                  <kbd className="px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded shadow-sm">
                    Enter
                  </kbd>
                  <span className="text-gray-400">to send</span>
                  <span className="text-gray-300">•</span>
                  <kbd className="px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded shadow-sm">
                    Shift + Enter
                  </kbd>
                  <span className="text-gray-400">for new line</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-gray-500">
                  <Database size={14} className="text-gray-400" />
                  Connect to your database to start exploring
                </span>
              )}
            </p>
          </div>
        </form>
      </div>
    </>
  );
};

export default ChatInput;