import { useState, useEffect } from 'react';
import Sidebar from '@/components/dashboard/Sidebar';
import ChatInput from '@/components/dashboard/ChatInput';
import ChatWindow from '@/components/dashboard/ChatWindow';
import UserProfile from '@/components/dashboard/UserProfile';
import Logo from '@/components/Logo';
import { DatabaseConnectionModal } from '@/components/dashboard/DatabaseConnectionModal';
import DeleteConfirmationModal from '@/components/dashboard/DeleteConfirmationModal';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import ConnectionStatus from '@/components/dashboard/ConnectionStatus';
import { confirmSQL } from '@/services/api'; 

const API_BASE = "http://localhost:8000";

interface Message {
  id: string;
  content: string;
  type: 'user' | 'assistant' | 'error';
  role?: string;
  timestamp: Date;
  canEdit?: boolean;
}

interface ChatSession {
  id: string;
  user_id?: number;
  title: string;
  timestamp: string | number | Date;
  messages: Message[];
  isStarred?: boolean;  // 🔥 ADDED
}

interface PendingSQL {
  sql: string;
  table: {
    columns: string[];
    data: string[][];
  };
}

const DashboardPage = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionData, setConnectionData] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [pendingSQL, setPendingSQL] = useState<PendingSQL | null>(null);
  const [isExecutingSQL, setIsExecutingSQL] = useState(false);
  
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    console.log('[DASHBOARD] User state changed:', user?.id);
    
    if (user?.id) {
      console.log(`[DASHBOARD] User ${user.id} logged in, loading chat history...`);
      loadChatHistory();
    } else {
      console.log('[DASHBOARD] User logged out, clearing all state');
      setChatHistory([]);
      setMessages([]);
      setCurrentChatId(null);
      setIsConnected(false);
      setConnectionData(null);
    }
  }, [user?.id]);

  const loadChatHistory = async () => {
    if (!user?.id) {
      console.log('[DASHBOARD] No user ID, skipping history load');
      return;
    }

    setIsLoadingHistory(true);
    try {
      console.log(`[DASHBOARD] Fetching chat sessions for user ${user.id}...`);
      const response = await fetch(`${API_BASE}/api/chat-sessions?user_id=${user.id}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          console.log('[DASHBOARD] No chat sessions found (404), starting fresh');
          setChatHistory([]);
          return;
        }
        throw new Error(`HTTP ${response.status}: Failed to fetch chat sessions`);
      }

      const data = await response.json();
      console.log(`[DASHBOARD] Received ${data.length} sessions from backend`);
      
      if (!Array.isArray(data)) {
        console.error('[DASHBOARD] Invalid response format:', data);
        setChatHistory([]);
        return;
      }
      
      const userSessions = data
        .filter((session: any) => {
          if (!session.id || !session.user_id) {
            console.warn('[DASHBOARD] Invalid session structure:', session);
            return false;
          }
          
          const matches = session.user_id === parseInt(user.id);
          if (!matches) {
            console.warn(`[DASHBOARD] Filtering out session ${session.id} - belongs to user ${session.user_id}, not ${user.id}`);
          }
          return matches;
        })
        .map((session: any) => {
          try {
            return {
              id: session.id.toString(),
              user_id: session.user_id,
              title: session.title || 'Untitled Chat',
              timestamp: session.timestamp || new Date().toISOString(),
              isStarred: session.isStarred || false,  // 🔥 ADDED
              messages: Array.isArray(session.messages) 
                ? session.messages.map((msg: any) => ({
                    id: msg.id || `msg-${Date.now()}`,
                    content: msg.content || '',
                    type: msg.type || 'user',
                    role: msg.role || (msg.type === 'user' ? 'user' : 'ai'),
                    timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
                  }))
                : []
            };
          } catch (err) {
            console.error('[DASHBOARD] Error parsing session:', session, err);
            return null;
          }
        })
        .filter((session: any) => session !== null);
      
      console.log(`[DASHBOARD] Successfully loaded ${userSessions.length} chat sessions for user ${user.id}`);
      setChatHistory(userSessions);
      
      if (userSessions.length > 0) {
        toast({
          title: "Chat History Loaded",
          description: `${userSessions.length} conversation(s) restored`,
        });
      }
      
    } catch (error: any) {
      console.error('[DASHBOARD] Error loading chat history:', error);
      
      if (!error.message.includes('404')) {
        toast({
          variant: "destructive",
          title: "Error Loading History",
          description: error.message || "Failed to load chat history",
        });
      }
      
      setChatHistory([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleConnect = async (data: any) => {
    console.log('[DASHBOARD] handleConnect called with data:', data);
    
    if (!data.db_type) {
      console.error('[DASHBOARD] Missing db_type in connection data:', data);
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Database type is missing. Please try reconnecting.",
      });
      return;
    }

    if (!data.database) {
      console.error('[DASHBOARD] Missing database in connection data:', data);
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Database name is missing. Please try reconnecting.",
      });
      return;
    }

    if (isConnected && connectionData?.database === data.database && connectionData?.host === data.host) {
      console.log('[DASHBOARD] Already connected to this database, skipping duplicate connection');
      return;
    }

    try {
      console.log('[DASHBOARD] Sending connection request to backend...');
      
      const response = await fetch(`${API_BASE}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: data.host,
          port: parseInt(data.port),
          user: data.user,
          password: data.password,
          database: data.database,
          db_type: data.db_type
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setConnectionData({
          ...data,
          db_type: result.db_type || data.db_type
        });
        setIsConnected(true);
        setIsModalOpen(false);
        
        console.log('[DASHBOARD] Connection successful! DB Type:', result.db_type);
        
        toast({
          title: "✅ Connected Successfully",
          description: `Connected to ${data.database} database (${data.db_type?.toUpperCase()})`,
        });
      } else {
        throw new Error(result.detail?.message || 'Connection failed');
      }
    } catch (error: any) {
      console.error('[DASHBOARD] Connection error:', error);
      toast({
        variant: "destructive",
        title: "Connection Failed",
        description: error.message || 'Failed to connect to database',
      });
    }
  };

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleNewChat = () => {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "User not authenticated",
      });
      return;
    }

    setMessages([]);
    setCurrentChatId(null);
    
    console.log('[DASHBOARD] Creating new chat for user:', user.id);
    
    toast({
      title: "New Chat",
      description: "Started a new conversation",
    });
  };

  const handleChatSelect = (chatId: string) => {
    const selectedChat = chatHistory.find(chat => chat.id === chatId);
    if (selectedChat) {
      console.log(`[DASHBOARD] Loading chat ${chatId} with ${selectedChat.messages.length} messages`);
      setMessages(selectedChat.messages);
      setCurrentChatId(chatId);
    }
  };

  const handleRenameChat = async (chatId: string, newTitle: string) => {
    if (!user?.id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "User not authenticated",
      });
      return;
    }

    console.log(`[DASHBOARD] Renaming chat ${chatId} to "${newTitle}"`);
    
    // Optimistically update UI
    setChatHistory(prev => 
      prev.map(chat => 
        chat.id === chatId 
          ? { ...chat, title: newTitle }
          : chat
      )
    );

    try {
      const response = await fetch(`${API_BASE}/api/chat-sessions/${chatId}/rename`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
          title: newTitle,
          user_id: parseInt(user.id)
        })
      });

      if (response.ok) {
        console.log(`[DASHBOARD] Successfully renamed chat ${chatId} on backend`);
        toast({
          title: "Chat Renamed",
          description: `Chat renamed to "${newTitle}"`,
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('[DASHBOARD] Backend rename failed:', errorData);
        toast({
          title: "Chat Renamed",
          description: `Chat renamed to "${newTitle}" (local only)`,
        });
      }
    } catch (error: any) {
      console.error('[DASHBOARD] Rename error:', error);
      toast({
        title: "Chat Renamed",
        description: `Chat renamed to "${newTitle}" (local only)`,
      });
    }
  };

  // 🔥 NEW FUNCTION: Handle star toggle
  const handleStarToggle = async (chatId: string, isStarred: boolean) => {
    if (!user?.id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "User not authenticated",
      });
      return;
    }

    console.log(`[DASHBOARD] Toggling star for chat ${chatId} to ${isStarred}`);
    
    // ✅ Optimistically update UI immediately
    setChatHistory(prev => 
      prev.map(chat => 
        chat.id === chatId 
          ? { ...chat, isStarred } 
          : chat
      )
    );

    // Note: Backend call is already handled in Sidebar component
    // We just update local state here for immediate UI feedback
    console.log(`[DASHBOARD] Star status updated locally for chat ${chatId}`);
  };

  const handleConfirmSQL = async () => {
    if (!pendingSQL || !user) return;

    setIsExecutingSQL(true);
    
    try {
      console.log('[DASHBOARD] Executing confirmed SQL:', pendingSQL.sql);
      
      const result = await confirmSQL(parseInt(user.id), pendingSQL.sql, true);
      
      const messagesWithDisabledEdit = messages.map((msg, index) => {
        if (index === messages.length - 1 && msg.type === 'user') {
          return { ...msg, canEdit: false };
        }
        return msg;
      });
      
      const assistantMessage: Message = {
        id: Date.now().toString(),
        content: `SQL: \`${pendingSQL.sql}\`\nOutput: ${JSON.stringify(result)}`,
        type: 'assistant',
        role: 'ai',
        timestamp: new Date()
      };
      
      const updatedMessages = [...messagesWithDisabledEdit, assistantMessage];
      setMessages(updatedMessages);
      
      if (currentChatId) {
        const chatTitle = messagesWithDisabledEdit[0]?.content.substring(0, 50) || 'SQL Query';
        await saveChatToBackend(currentChatId, chatTitle, updatedMessages, false);
      }
      
      toast({
        title: "✅ SQL Executed",
        description: "Your query has been executed successfully",
      });
      
    } catch (error: any) {
      console.error('[DASHBOARD] SQL execution error:', error);
      
      const errorMessage: Message = {
        id: Date.now().toString(),
        content: `Error executing SQL: ${error.message}`,
        type: 'error',
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorMessage]);
      
      toast({
        variant: "destructive",
        title: "Execution Failed",
        description: error.message || "Failed to execute SQL",
      });
    } finally {
      setIsExecutingSQL(false);
      setIsDeleteModalOpen(false);
      setPendingSQL(null);
      setIsLoading(false);
    }
  };

  const handleCancelSQL = async () => {
    if (!pendingSQL || !user) return;

    try {
      await confirmSQL(parseInt(user.id), pendingSQL.sql, false);
      
      const cancelMessage: Message = {
        id: Date.now().toString(),
        content: 'SQL execution cancelled by user',
        type: 'assistant',
        role: 'ai',
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, cancelMessage]);
      
      toast({
        title: "Cancelled",
        description: "SQL execution has been cancelled",
      });
      
    } catch (error) {
      console.error('[DASHBOARD] Cancel error:', error);
    } finally {
      setIsDeleteModalOpen(false);
      setPendingSQL(null);
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!message || !message.trim()) return;
    
    if (!user) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "User not authenticated",
      });
      return;
    }
    
    const chatTitle = message.length > 50 
      ? message.substring(0, 50).trim() + '...' 
      : message.trim();
    
    const chatId = currentChatId || Date.now().toString();
    const isNewChat = !currentChatId;
    
    if (isNewChat) {
      setCurrentChatId(chatId);
    }
    
    const userMessage: Message = {
      id: Date.now().toString(),
      content: message,
      type: 'user',
      role: 'user',
      timestamp: new Date()
    };
    
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    
    if (!isConnected) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: 'Database connection unavailable. Please connect to a database to get accurate results.',
        type: 'error',
        timestamp: new Date()
      };
      const messagesWithError = [...newMessages, errorMessage];
      setMessages(messagesWithError);
      
      await saveChatToBackend(chatId, chatTitle, messagesWithError, isNewChat);
      return;
    }
    
    setIsLoading(true);
    
    try {
      const payload = {
        question: message,
        chat_history: messages.map(msg => ({
          role: msg.type === 'user' ? 'human' : 'ai',
          content: msg.content
        })),
      };

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();

      if (data.success && data.response) {
        try {
          console.log('[DASHBOARD] Full response:', data.response);
          
          let outputData;
          
          try {
            outputData = JSON.parse(data.response);
          } catch {
            const responseParts = data.response.split('\nOutput: ');
            if (responseParts.length === 2) {
              outputData = JSON.parse(responseParts[1]);
            }
          }
          
          if (outputData && outputData.type === 'confirmation_required') {
            console.log('[DASHBOARD] Confirmation required for SQL:', outputData.sql);
            console.log('[DASHBOARD] Table data:', outputData.table);
            
            setPendingSQL({
              sql: outputData.sql,
              table: outputData.table
            });
            
            setIsDeleteModalOpen(true);
            return;
          }
        } catch (parseError) {
          console.error('[DASHBOARD] Error parsing response:', parseError);
          console.log('[DASHBOARD] Normal response (not confirmation)');
        }
      }

      let assistantContent = '';
      if (data.success) {
        assistantContent = data.response;
      } else {
        assistantContent = `Error: ${data.error}`;
      }

      const assistantMessage: Message = {
        id: (Date.now() + 2).toString(),
        content: assistantContent,
        type: 'assistant',
        role: 'ai',
        timestamp: new Date()
      };
      
      const finalMessages = [...newMessages, assistantMessage];
      setMessages(finalMessages);
      
      await saveChatToBackend(chatId, chatTitle, finalMessages, isNewChat);

    } catch (error) {
      console.error("[DASHBOARD] Failed to send message:", error);
      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        content: 'Sorry, an unexpected error occurred while communicating with the server.',
        type: 'error',
        timestamp: new Date()
      };
      const messagesWithError = [...newMessages, errorMessage];
      setMessages(messagesWithError);
      
      await saveChatToBackend(chatId, chatTitle, messagesWithError, isNewChat);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditMessage = async (messageId: string, newContent: string) => {
    console.log('[DASHBOARD] Editing message:', messageId, 'New content:', newContent);
    
    if (!user) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "User not authenticated",
      });
      return;
    }

    const messageIndex = messages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) {
      console.error('[DASHBOARD] Message not found');
      return;
    }

    const message = messages[messageIndex];
    const effectiveType = message.role === 'ai' ? 'assistant' : message.type;
    if (effectiveType !== 'user') {
      console.error('[DASHBOARD] Can only edit user messages');
      return;
    }

    const updatedMessages = messages.slice(0, messageIndex);
    console.log(`[DASHBOARD] Removed ${messages.length - messageIndex} messages after edit`);
    
    const editedMessage: Message = {
      ...message,
      content: newContent,
      id: Date.now().toString(),
      timestamp: new Date()
    };
    
    setMessages([...updatedMessages, editedMessage]);
    setIsLoading(true);

    try {
      const chatHistoryPayload = updatedMessages.map(msg => ({
        role: msg.type === 'user' ? 'human' : 'ai',
        content: msg.content
      }));

      console.log('[DASHBOARD] Sending edited message to backend...');

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: newContent,
          chat_history: chatHistoryPayload
        }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      console.log('[DASHBOARD] Received new response from backend');

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: data.success ? data.response : `Error: ${data.error}`,
        type: 'assistant',
        role: 'ai',
        timestamp: new Date()
      };
      
      const finalMessages = [...updatedMessages, editedMessage, assistantMessage];
      setMessages(finalMessages);
      
      if (currentChatId) {
        const chatTitle = finalMessages[0]?.content.substring(0, 50) || 'Edited Chat';
        await saveChatToBackend(currentChatId, chatTitle, finalMessages, false);
      }

      console.log('[DASHBOARD] Edit complete with new AI response');
      
      toast({
        title: "Message Edited",
        description: "Your message has been updated with a new response",
      });
      
    } catch (error: any) {
      console.error('[DASHBOARD] Error getting new response:', error);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: 'Failed to get response for edited message.',
        type: 'error',
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorMessage]);
      
      toast({
        variant: "destructive",
        title: "Edit Failed",
        description: error.message || "Failed to get response for edited message",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveChatToBackend = async (
    chatId: string, 
    title: string, 
    messages: Message[], 
    isNewChat: boolean
  ) => {
    if (!user) {
      console.error('[DASHBOARD] Cannot save chat: User not authenticated');
      return;
    }

    try {
      const payload = {
        user_id: parseInt(user.id),
        title,
        messages: messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          type: msg.type,
          role: msg.role || (msg.type === 'user' ? 'user' : 'ai'),
          timestamp: msg.timestamp.toISOString(),
          canEdit: msg.canEdit
        }))
      };

      if (isNewChat) {
        console.log(`[DASHBOARD] Creating new chat session for user ${user.id}`);
        const response = await fetch(`${API_BASE}/api/chat-sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Failed to create chat session');
        }

        const newSession = await response.json();
        console.log(`[DASHBOARD] Created session ${newSession.id} for user ${user.id}`);
        
        setCurrentChatId(newSession.id.toString());
        
        const sessionToAdd: ChatSession = {
          id: newSession.id.toString(),
          user_id: parseInt(user.id),
          title: newSession.title,
          timestamp: newSession.timestamp,
          messages: messages,
          isStarred: newSession.isStarred || false  // 🔥 ADDED
        };
        
        setChatHistory(prev => [sessionToAdd, ...prev]);
        console.log(`[DASHBOARD] Added session to history. Total sessions: ${chatHistory.length + 1}`);
        
      } else {
        console.log(`[DASHBOARD] Updating chat session ${chatId} for user ${user.id}`);
        const response = await fetch(`${API_BASE}/api/chat-sessions/${chatId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Failed to update chat session');
        }

        const updatedSession = await response.json();
        console.log(`[DASHBOARD] Updated session ${chatId}`);
        
        setChatHistory(prev => 
          prev.map(chat => 
            chat.id === chatId 
              ? { ...chat, messages, timestamp: updatedSession.timestamp }
              : chat
          )
        );
      }
    } catch (error: any) {
      console.error('[DASHBOARD] Error saving chat:', error);
      toast({
        variant: "destructive",
        title: "Save Error",
        description: error.message || "Failed to save chat session",
      });
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "User not authenticated",
      });
      return;
    }

    try {
      console.log(`[DASHBOARD] Deleting chat ${chatId} for user ${user.id}`);
      const response = await fetch(
        `${API_BASE}/api/chat-sessions/${chatId}?user_id=${user.id}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete session');
      }

      setChatHistory(prev => prev.filter(chat => chat.id !== chatId));
      
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setMessages([]);
      }
      
      console.log(`[DASHBOARD] Deleted chat ${chatId}. Remaining sessions: ${chatHistory.length - 1}`);
      
      toast({
        title: "Chat Deleted",
        description: "Chat history has been removed",
      });
    } catch (error: any) {
      console.error('[DASHBOARD] Delete error:', error);
      toast({
        variant: "destructive",
        title: "Delete Error",
        description: error.message || "Failed to delete chat session",
      });
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${API_BASE}/api/disconnect`, { method: 'POST' });
      
      setIsConnected(false);
      setConnectionData(null);
      
      toast({
        title: "Disconnected",
        description: "Database connection has been closed",
      });
    } catch (error) {
      console.error('[DASHBOARD] Disconnect error:', error);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isConnected={isConnected}
          onConnect={handleConnect}
          onNewChat={handleNewChat}
          chatHistory={chatHistory}
          onOpenModal={handleOpenModal}
          onChatSelect={handleChatSelect}
          currentChatId={currentChatId}
          onDeleteChat={handleDeleteChat}
          onDisconnect={handleDisconnect}
          userId={user?.id ? parseInt(user.id) : null}
          isLoadingHistory={isLoadingHistory}
          onRenameChat={handleRenameChat}
          onStarToggle={handleStarToggle}  // 🔥 ADDED
        />

        <div className="flex-1 flex flex-col relative">
          <header className="flex items-center justify-between p-4 bg-surface">
            <Logo size="sm" />
            <div className="flex items-center gap-3">
              <ConnectionStatus 
                isConnected={isConnected} 
                databaseName={connectionData?.database}
                dbType={connectionData?.db_type}
                onDisconnect={handleDisconnect}
                onSwitchDatabase={handleOpenModal}
              />
              <UserProfile />
            </div>
          </header>

          <ChatWindow 
            messages={messages}
            onConnectDatabase={handleOpenModal}
            onEditMessage={handleEditMessage}
          />

          <ChatInput
            onSend={handleSendMessage}
            isLoading={isLoading}
            isConnected={isConnected}
            onOpenModal={handleOpenModal}
          />
        </div>
      </div>

      <DatabaseConnectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConnect={handleConnect}
      />

      {pendingSQL && (
        <DeleteConfirmationModal
          isOpen={isDeleteModalOpen}
          onClose={handleCancelSQL}
          onConfirm={handleConfirmSQL}
          queryDetails={{
            action: pendingSQL.table.data[0][0],
            table: pendingSQL.table.data[0][1],
            condition: pendingSQL.table.data[0][2],
            impact: pendingSQL.table.data[0][3]
          }}
          sql={pendingSQL.sql}
          isLoading={isExecutingSQL}
        />
      )}
    </div>
  );
};

export default DashboardPage;