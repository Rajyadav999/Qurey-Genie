import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Database, CheckCircle2, Copy, Check, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import EnhancedDataTable from './EnhancedDataTable';

interface Message {
  id: string;
  type: 'user' | 'assistant' | 'error';
  content: string;
  role?: string;
  canEdit?: boolean;
}

interface ChatWindowProps {
  messages: Message[];
  onConnectDatabase: () => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
}

interface ParsedOutput {
  type: 'select' | 'status' | 'error' | 'confirmation_required';
  data?: string[][];
  columns?: string[];
  row_count?: number;
  message?: string;
  affected_rows?: number;
  sql?: string;
  table?: {
    columns: string[];
    data: string[][];
  };
}

function parseBackendResponse(content: string): {
  sql: string | null;
  output: ParsedOutput | null;
} {
  try {
    const sqlMatch = content.match(/SQL:\s*`([^`]+)`/);
    const sql = sqlMatch ? sqlMatch[1] : null;
    
    const outputMatch = content.match(/Output:\s*({.+})/s);
    if (outputMatch) {
      try {
        const output = JSON.parse(outputMatch[1]) as ParsedOutput;
        return { sql, output };
      } catch (error) {
        console.error('Failed to parse output JSON:', error);
      }
    }
  } catch (error) {
    console.error('Error parsing backend response:', error);
  }
  
  return { sql: null, output: null };
}

const ChatWindow: React.FC<ChatWindowProps> = ({ 
  messages, 
  onConnectDatabase,
  onEditMessage 
}) => {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [userScrolled, setUserScrolled] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);

  const lastUserMessageId = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const effectiveType = message.role === 'ai' ? 'assistant' : message.type;
      if (effectiveType === 'user') {
        return message.id;
      }
    }
    return null;
  }, [messages]);

  // Smooth scroll to bottom function
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  };

  // Check if user is near bottom of chat
  const isNearBottom = () => {
    if (!chatContainerRef.current) return true;
    
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // Consider "near bottom" if within 100px
    return distanceFromBottom < 100;
  };

  // Handle user scroll to detect manual scrolling
  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    
    // If user manually scrolls up, set flag
    if (!isNearBottom()) {
      setUserScrolled(true);
    } else {
      setUserScrolled(false);
    }
  };

  // Auto-scroll when new messages arrive
  useEffect(() => {
    const messageCountChanged = messages.length !== lastMessageCountRef.current;
    const hasMessages = messages.length > 0;
    
    if (messageCountChanged && hasMessages) {
      const lastMessage = messages[messages.length - 1];
      const isAssistantMessage = lastMessage.role === 'ai' || lastMessage.type === 'assistant';
      
      // Auto-scroll if:
      // 1. User hasn't manually scrolled up, OR
      // 2. It's a new assistant message (AI response)
      if (!userScrolled || isAssistantMessage) {
        // Use instant scroll for first message, smooth for others
        const behavior = lastMessageCountRef.current === 0 ? 'instant' : 'smooth';
        
        // Small delay to ensure DOM has updated
        setTimeout(() => {
          scrollToBottom(behavior);
        }, 100);
      }
      
      lastMessageCountRef.current = messages.length;
    }
  }, [messages, userScrolled]);

  // Reset scroll flag when editing stops
  useEffect(() => {
    if (!editingMessageId) {
      setUserScrolled(false);
    }
  }, [editingMessageId]);

  // 🔥 NEW: Trigger database refresh when DDL operations complete
  useEffect(() => {
    // Track which messages we've already processed to avoid duplicate refreshes
    const processedMessages = new Set<string>();
    
    messages.forEach(message => {
      // Skip if we've already processed this message
      if (processedMessages.has(message.id)) return;
      
      const effectiveType = message.role === 'ai' ? 'assistant' : message.type;
      
      if (effectiveType === 'assistant') {
        const { sql, output } = parseBackendResponse(message.content);
        
        // Check if this is a DDL operation (CREATE, DROP, ALTER, TRUNCATE)
        if (sql && output?.type === 'status') {
          const isDDL = /^\s*(CREATE|DROP|ALTER|TRUNCATE)\s+/i.test(sql);
          if (isDDL) {
            // Mark as processed
            processedMessages.add(message.id);
            
            // Trigger schema refresh after a short delay
            setTimeout(() => {
              window.dispatchEvent(new Event('refreshDatabaseSchema'));
            }, 500);
          }
        }
      }
    });
  }, [messages]);

  const handleCopyMessage = async (messageId: string, content: string, isUser: boolean) => {
    try {
      let textToCopy = content;
      
      if (!isUser) {
        const { sql, output } = parseBackendResponse(content);
        
        if (output) {
          if (output.type === 'select' && output.data && output.columns) {
            textToCopy = [
              output.columns.join('\t'),
              ...output.data.map(row => row.join('\t'))
            ].join('\n');
          } else if (output.message) {
            textToCopy = output.message;
          } else if (sql) {
            textToCopy = sql;
          }
        }
      }
      
      await navigator.clipboard.writeText(textToCopy);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleStartEdit = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditContent(content);
  };

  const handleSaveEdit = (messageId: string) => {
    if (onEditMessage && editContent.trim()) {
      onEditMessage(messageId, editContent.trim());
      setEditingMessageId(null);
      setEditContent('');
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, messageId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit(messageId);
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };
  
  return (
    <div 
      ref={chatContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto bg-white"
    >
      <div className="max-w-4xl mx-auto px-4">
        <div className="space-y-6 [&>*:first-child]:!mt-0 [&>*:first-child]:!pt-0 pb-4">
        {messages.length === 0 ? (
          <div className="text-center pb-12 max-w-2xl mx-auto pt-0">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Welcome to Query Genie
            </h2>
            <p className="text-lg text-gray-600 mb-8">
             Ask questions in plain English and get instant answers from your database—no SQL required
            </p>
           
          </div>
        ) : (
          messages.map((message) => {
            const effectiveType = message.role === 'ai' ? 'assistant' : message.type;
            
            if (effectiveType === 'user') {
              const isEditing = editingMessageId === message.id;
              const isLastUserMessage = message.id === lastUserMessageId;
              const canEditMessage = message.canEdit !== false;
              
              return (
                <div key={message.id} className="flex justify-end group">
                  <div className="max-w-[70%]">
                    {isEditing ? (
                      <div className="max-w-[70%]">
                        <Textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => handleEditKeyDown(e, message.id)}
                          className="w-full min-h-[100px] max-h-[300px] bg-white text-gray-900 border-2 border-blue-500 rounded-2xl focus:ring-0 focus:border-blue-600 mb-3 resize-none p-4 text-base shadow-sm"
                          autoFocus
                          rows={3}
                        />
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex items-start gap-2">
                          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-gray-700 leading-relaxed">
                            Editing this message will update your question. The AI will use the edited version to generate a new response.
                          </p>
                        </div>
                        <div className="flex gap-3 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCancelEdit}
                            className="h-10 px-5 text-sm font-medium border-gray-300 rounded-lg hover:bg-gray-100"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSaveEdit(message.id)}
                            className="h-10 px-5 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-900"
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="bg-blue-600 text-white px-4 py-3 rounded-lg shadow-sm">
                          {message.content}
                        </div>
                        <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopyMessage(message.id, message.content, true)}
                            className="h-8 w-8 p-0 text-gray-600 hover:text-gray-900 hover:bg-white rounded-full border border-gray-200 shadow-sm"
                            title="Copy"
                          >
                            {copiedMessageId === message.id ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                          {isLastUserMessage && canEditMessage && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleStartEdit(message.id, message.content)}
                              className="h-8 w-8 p-0 text-gray-600 hover:text-gray-900 hover:bg-white rounded-full border border-gray-200 shadow-sm"
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            }

            if (effectiveType === 'error') {
              return (
                <div key={message.id} className="flex justify-center">
                  <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg max-w-2xl flex items-start gap-3">
                    <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
                    <div className="space-y-2">
                      <p className="font-medium">{message.content}</p>
                      <Button
                        onClick={onConnectDatabase}
                        variant="outline"
                        size="sm"
                        className="border-red-200 text-red-800 hover:bg-red-100"
                      >
                        <Database size={16} className="mr-2" />
                        Connect Database
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }

            if (effectiveType === 'assistant') {
              const { sql, output } = parseBackendResponse(message.content);

              return (
                <div key={message.id} className="flex justify-start w-full group">
                  <div className="w-full max-w-full space-y-3">
                    {output && output.type === 'select' && output.data && output.columns && (
                      <EnhancedDataTable
                        data={output.data}
                        columns={output.columns}
                        sqlQuery={sql || undefined}
                        executionTime={45}
                        searchable={true}
                        exportable={true}
                        sortable={false}
                        showPagination={true}
                      />
                    )}

                    {output && output.type === 'status' && (
                      <Alert className="border-green-500/50 bg-green-500/10">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <AlertDescription className="text-green-700">
                          {output.message}
                          {output.affected_rows !== undefined && (
                            <span className="ml-2 font-semibold">
                              ({output.affected_rows} row{output.affected_rows !== 1 ? 's' : ''})
                            </span>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}

                    {output && output.type === 'error' && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {output.message}
                        </AlertDescription>
                      </Alert>
                    )}

                    {output && output.type === 'confirmation_required' && (
                      <Card className="p-4 border-yellow-500/50 bg-yellow-500/10">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="font-semibold text-yellow-700 mb-2">
                              ⚠️ Dangerous Operation Detected
                            </p>
                            <p className="text-sm text-gray-600 mb-3">
                              This query will modify or delete data. Please review carefully.
                            </p>
                            {output.table && (
                              <EnhancedDataTable
                                data={output.table.data}
                                columns={output.table.columns}
                                sqlQuery={sql || undefined}
                                searchable={false}
                                exportable={false}
                                sortable={false}
                                showPagination={true}
                              />
                            )}
                          </div>
                        </div>
                      </Card>
                    )}

                    {!output && (
                      <Card className="p-4 bg-gray-50">
                        <pre className="text-sm font-mono whitespace-pre-wrap break-all text-gray-700">
                          {message.content}
                        </pre>
                      </Card>
                    )}

                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopyMessage(message.id, message.content, false)}
                        className="h-8 w-8 p-0 text-gray-600 hover:text-gray-900 hover:bg-white rounded-full border border-gray-200 shadow-sm"
                        title="Copy"
                      >
                        {copiedMessageId === message.id ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }

            return null;
          })
        )}
        {/* Invisible element to scroll to */}
        <div ref={messagesEndRef} />
      </div>
    </div>
    </div>
  );
};

export default ChatWindow;