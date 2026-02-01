import { useState, useRef, useEffect, useCallback } from 'react';
import { Menu, Database, MessageSquare, MoreVertical, Trash2, Plus, RefreshCw, Unplug, Heart, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';

const API_BASE = "http://localhost:8000";

interface ChatSession {
  id: string;
  user_id?: number;
  title: string;
  timestamp: string | number | Date;
  isStarred?: boolean;
  messages: Array<{
    id: string;
    content: string;
    type: 'user' | 'assistant' | 'error';
    timestamp: Date;
  }>;
}

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isConnected: boolean;
  onConnect: (connectionData: any) => void;
  onNewChat: () => void;
  chatHistory: ChatSession[];
  onOpenModal: () => void;
  onChatSelect: (chatId: string) => void;
  currentChatId: string | null;
  onDeleteChat: (chatId: string) => void;
  onDisconnect: () => void;
  userId: number | null;
  isLoadingHistory?: boolean;
  onRenameChat?: (chatId: string, newTitle: string) => void;
  onStarToggle?: (chatId: string, isStarred: boolean) => void; // Add this prop
}

const formatTimestamp = (timestamp: string | number | Date): string => {
  if (!timestamp) {
    return 'Just now';
  }

  if (typeof timestamp === 'string' && (timestamp.includes('ago') || timestamp.includes('now'))) {
    return timestamp;
  }

  try {
    const date = new Date(timestamp);
    
    if (isNaN(date.getTime())) {
      return 'Just now';
    }

    return date.toISOString();
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return new Date().toISOString();
  }
};

const Sidebar = ({ 
  isCollapsed, 
  onToggleCollapse, 
  isConnected, 
  onConnect, 
  onNewChat, 
  chatHistory = [], 
  onOpenModal, 
  onChatSelect, 
  currentChatId, 
  onDeleteChat, 
  onDisconnect,
  userId,
  isLoadingHistory = false,
  onRenameChat,
  onStarToggle // Add this
}: SidebarProps) => {
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  const [isTogglingStars, setIsTogglingStars] = useState<Set<string>>(new Set());
  
  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState<number>(288);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 480;
  const COLLAPSED_WIDTH = 64;
  
  const safeHistory = Array.isArray(chatHistory) ? chatHistory : [];

  // Handle mouse down on resize handle
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  // Handle mouse move during resize
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const newWidth = e.clientX;
    
    if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
      setSidebarWidth(newWidth);
    }
  }, [isResizing]);

  // Handle mouse up to stop resizing
  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add and remove event listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!userId) {
      console.error('User not authenticated');
      return;
    }

    const chatExists = safeHistory.find(chat => chat?.id === chatId);
    if (!chatExists) {
      console.error('[SIDEBAR] Chat not found in local state:', chatId);
      return;
    }

    setDeletingChatId(chatId);

    try {
      console.log(`[SIDEBAR] Deleting chat ${chatId} for user ${userId}`);
      
      const response = await fetch(
        `${API_BASE}/api/chat-sessions/${chatId}?user_id=${userId}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        console.log(`[SIDEBAR] Successfully deleted chat ${chatId}`);
        onDeleteChat(chatId);
      } else {
        if (response.status === 404) {
          console.warn(`[SIDEBAR] Chat ${chatId} not found (404), removing from UI`);
          onDeleteChat(chatId);
        } else if (response.status === 403) {
          console.error('Permission denied');
        } else {
          console.error(`[SIDEBAR] Delete failed with status ${response.status}`);
          onDeleteChat(chatId);
        }
      }
    } catch (error: any) {
      console.error('[SIDEBAR] Delete error:', error);
      onDeleteChat(chatId);
    } finally {
      setDeletingChatId(null);
    }
  };

  // 🔥 FIXED: Star toggle with backend persistence
  const handleStarToggle = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!userId) {
      console.error('[SIDEBAR] User not authenticated');
      return;
    }

    // Don't allow multiple simultaneous star toggles for the same chat
    if (isTogglingStars.has(chatId)) {
      return;
    }

    const chat = safeHistory.find(c => c.id === chatId);
    if (!chat) {
      console.error('[SIDEBAR] Chat not found:', chatId);
      return;
    }

    const newStarState = !chat.isStarred;
    
    // Mark as toggling
    setIsTogglingStars(prev => new Set(prev).add(chatId));

    try {
      console.log(`[SIDEBAR] Toggling star for chat ${chatId} to ${newStarState}`);
      
      const response = await fetch(
        `${API_BASE}/api/chat-sessions/${chatId}/star`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            is_starred: newStarState
          })
        }
      );

      if (response.ok) {
        console.log(`[SIDEBAR] Successfully toggled star for chat ${chatId}`);
        // Call parent callback to update state
        if (onStarToggle) {
          onStarToggle(chatId, newStarState);
        }
      } else {
        console.error(`[SIDEBAR] Star toggle failed with status ${response.status}`);
        const errorData = await response.json().catch(() => ({}));
        console.error('[SIDEBAR] Error details:', errorData);
      }
    } catch (error: any) {
      console.error('[SIDEBAR] Star toggle error:', error);
    } finally {
      // Remove from toggling set
      setIsTogglingStars(prev => {
        const newSet = new Set(prev);
        newSet.delete(chatId);
        return newSet;
      });
    }
  };

  const handleRenameClick = (chat: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  };

  // 🔥 FIXED: Rename with backend persistence
  const handleRenameSubmit = async (chatId: string) => {
    if (!editingTitle.trim()) {
      setEditingChatId(null);
      setEditingTitle('');
      return;
    }

    if (!userId) {
      console.error('[SIDEBAR] User not authenticated');
      setEditingChatId(null);
      setEditingTitle('');
      return;
    }

    const currentChat = safeHistory.find(chat => chat.id === chatId);
    if (currentChat && currentChat.title === editingTitle.trim()) {
      setEditingChatId(null);
      setEditingTitle('');
      return;
    }

    setIsRenaming(true);

    try {
      console.log(`[SIDEBAR] Renaming chat ${chatId} to "${editingTitle.trim()}"`);
      
      const response = await fetch(
        `${API_BASE}/api/chat-sessions/${chatId}/rename`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            title: editingTitle.trim()
          })
        }
      );

      if (response.ok) {
        console.log(`[SIDEBAR] Successfully renamed chat ${chatId}`);
        
        // Call parent callback to update state
        if (onRenameChat) {
          onRenameChat(chatId, editingTitle.trim());
        }
        
        setEditingChatId(null);
        setEditingTitle('');
      } else {
        console.error(`[SIDEBAR] Rename failed with status ${response.status}`);
        const errorData = await response.json().catch(() => ({}));
        console.error('[SIDEBAR] Error details:', errorData);
        
        // Still clear the editing state
        setEditingChatId(null);
        setEditingTitle('');
      }
    } catch (error) {
      console.error('[SIDEBAR] Rename error:', error);
      setEditingChatId(null);
      setEditingTitle('');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, chatId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit(chatId);
    } else if (e.key === 'Escape') {
      setEditingChatId(null);
      setEditingTitle('');
    }
  };

  const handleRenameCancel = () => {
    setEditingChatId(null);
    setEditingTitle('');
  };

  // Sort chats into starred and regular
  const starredChatsList = safeHistory.filter(chat => chat.isStarred);
  const regularChatsList = safeHistory.filter(chat => !chat.isStarred);

  const renderChatItem = (chat: ChatSession) => {
    const isStarred = chat.isStarred || false;
    const isEditing = editingChatId === chat.id;
    const isToggling = isTogglingStars.has(chat.id);

    return (
      <div
        key={chat.id}
        className={`group relative rounded-xl mb-1.5 transition-all duration-300 ${
          currentChatId === chat.id 
            ? 'bg-gradient-to-r from-indigo-50/80 via-violet-50/60 to-indigo-50/40 dark:from-indigo-950/30 dark:via-violet-950/20 dark:to-indigo-950/10 border border-indigo-200/40 dark:border-indigo-800/30 shadow-sm shadow-indigo-500/5' 
            : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/20 border border-transparent'
        } ${deletingChatId === chat.id ? 'opacity-40 pointer-events-none' : ''}`}
      >
        <div className="flex items-center justify-between">
          <div
            onClick={() => !isEditing && onChatSelect(chat.id)}
            className="flex-1 cursor-pointer p-3"
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 transition-all duration-300 ${
                currentChatId === chat.id 
                  ? 'text-indigo-600 dark:text-indigo-400' 
                  : 'text-slate-400 dark:text-slate-600 group-hover:text-slate-600 dark:group-hover:text-slate-400'
              }`}>
                <MessageSquare size={16} strokeWidth={2.5} />
              </div>
              
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="space-y-2 w-full pr-2" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => handleRenameKeyDown(e, chat.id)}
                      className="
                        h-8 text-sm px-3 py-1.5 w-full 
                        border-2 border-indigo-200 dark:border-indigo-800/50 
                        focus:border-indigo-400 dark:focus:border-indigo-600 
                        focus-visible:ring-4 focus-visible:ring-cyan-400/20
                        rounded-xl transition-all duration-300
                        bg-white dark:bg-slate-900
                        text-slate-900 dark:text-slate-100
                      "
                      autoFocus
                      disabled={isRenaming}
                      placeholder="Enter chat title..."
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameSubmit(chat.id);
                        }}
                        disabled={isRenaming || !editingTitle.trim()}
                        className="
                          h-7 text-xs px-4 
                          bg-gradient-to-r from-indigo-600 to-violet-600 
                          hover:from-indigo-500 hover:to-violet-500
                          text-white rounded-lg 
                          disabled:opacity-40 disabled:cursor-not-allowed 
                          transition-all duration-300 font-semibold 
                          shadow-lg shadow-indigo-500/30
                          hover:shadow-xl hover:shadow-indigo-500/40
                          active:scale-95
                        "
                      >
                        {isRenaming ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameCancel();
                        }}
                        disabled={isRenaming}
                        className="
                          h-7 text-xs px-4 
                          bg-slate-100 dark:bg-slate-800 
                          text-slate-700 dark:text-slate-300 
                          rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 
                          disabled:opacity-40 transition-all duration-300 font-semibold
                          active:scale-95
                        "
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      {isStarred && (
                        <Heart 
                          size={12} 
                          className="text-pink-500 fill-pink-500 flex-shrink-0 transition-all duration-300 animate-in zoom-in-50" 
                          strokeWidth={2.5}
                        />
                      )}
                      <h4 className={`font-semibold text-sm truncate transition-colors duration-300 ${
                        currentChatId === chat.id 
                          ? 'text-slate-900 dark:text-slate-50' 
                          : 'text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100'
                      }`}>
                        {chat.title}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-500 truncate mt-1 font-medium transition-colors duration-300">
                      {formatTimestamp(chat.timestamp)}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
          
          {/* Three-dot menu */}
          {!isEditing && (
            <div className="flex-shrink-0 pr-2 opacity-0 group-hover:opacity-100 transition-all duration-300 ease-out">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div
                    className="
                      h-8 w-8 flex items-center justify-center 
                      hover:bg-slate-200/60 dark:hover:bg-slate-700/60 
                      rounded-lg cursor-pointer transition-all duration-300 
                      active:scale-90
                    "
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical size={16} className="text-slate-600 dark:text-slate-400" strokeWidth={2.5} />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent 
                  align="end" 
                  className="
                    w-48 rounded-2xl shadow-2xl 
                    border-2 border-slate-200/50 dark:border-slate-700/50
                    bg-white/95 dark:bg-slate-900/95
                    backdrop-blur-xl
                    p-2
                  "
                >
                  <DropdownMenuItem
                    onClick={(e) => handleStarToggle(chat.id, e)}
                    disabled={isToggling}
                    className="
                      text-sm cursor-pointer rounded-xl 
                      transition-all duration-300 
                      focus:bg-indigo-50 dark:focus:bg-indigo-950/30
                      px-3 py-2.5
                      font-medium
                      disabled:opacity-50 disabled:cursor-not-allowed
                    "
                  >
                    <Heart 
                      size={16} 
                      className={`mr-3 transition-all duration-300 ${
                        isStarred ? 'fill-pink-500 text-pink-500' : 'text-slate-600 dark:text-slate-400'
                      } ${isToggling ? 'animate-pulse' : ''}`}
                      strokeWidth={2.5}
                    />
                    {isToggling ? 'Updating...' : isStarred ? 'Unfavorite' : 'Favorite'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => handleRenameClick(chat, e)}
                    className="
                      text-sm cursor-pointer rounded-xl 
                      transition-all duration-300 
                      focus:bg-indigo-50 dark:focus:bg-indigo-950/30
                      px-3 py-2.5
                      font-medium
                    "
                  >
                    <PenLine size={16} className="mr-3 text-slate-600 dark:text-slate-400" strokeWidth={2.5} />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-slate-200 dark:bg-slate-700 my-2" />
                  <DropdownMenuItem
                    onClick={(e) => handleDeleteChat(chat.id, e)}
                    disabled={deletingChatId === chat.id}
                    className="
                      text-red-600 dark:text-red-400 text-sm cursor-pointer 
                      rounded-xl transition-all duration-300 
                      focus:bg-red-50 dark:focus:bg-red-950/30
                      px-3 py-2.5
                      font-medium
                    "
                  >
                    <Trash2 size={16} className="mr-3" strokeWidth={2.5} />
                    {deletingChatId === chat.id ? 'Deleting...' : 'Delete'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div 
      ref={sidebarRef}
      style={{ width: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth }}
      className={`
        relative h-full 
        bg-white dark:bg-slate-950 
        border-r-2 border-slate-200/60 dark:border-slate-800/60
        transition-all duration-300 flex-shrink-0
      `}
    >
      <div className="flex flex-col h-full">
        {/* Header with menu toggle */}
        <div className="flex items-center justify-end p-4 border-b-2 border-slate-200/60 dark:border-slate-800/60">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className="
              p-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 
              rounded-xl transition-all duration-300 
              active:scale-90
              focus-visible:ring-4 focus-visible:ring-cyan-400/40
            "
          >
            <Menu size={20} strokeWidth={2.5} className="text-slate-700 dark:text-slate-300" />
          </Button>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {!isCollapsed && (
            <>
              {/* Connection status */}
              <div className="p-4 border-b-2 border-slate-200/60 dark:border-slate-800/60">
                <div className="flex items-center gap-2.5 text-sm">
                  <div className={`relative w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                    isConnected 
                      ? 'bg-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.6)]' 
                      : 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]'
                  }`}>
                    {isConnected && (
                      <>
                        <div className="absolute inset-0 w-2.5 h-2.5 bg-cyan-400/60 rounded-full animate-ping"></div>
                        <div className="absolute inset-[-4px] w-4.5 h-4.5 bg-cyan-400/20 rounded-full animate-pulse"></div>
                      </>
                    )}
                  </div>
                  <span className="text-slate-600 dark:text-slate-400 font-semibold tracking-tight">
                    {isConnected ? 'Database Connected' : 'No Connection'}
                  </span>
                </div>
              </div>

              {/* Database connection buttons */}
              {!isConnected ? (
                <div className="p-4 border-b-2 border-slate-200/60 dark:border-slate-800/60">
                  <Button 
                    onClick={onOpenModal} 
                    size="sm" 
                    className="
                      w-full h-10 text-sm 
                      bg-gradient-to-r from-indigo-600 to-violet-600 
                      hover:from-indigo-500 hover:to-violet-500
                      text-white rounded-xl 
                      transition-all duration-300 
                      shadow-lg shadow-indigo-500/30
                      hover:shadow-xl hover:shadow-indigo-500/40
                      active:scale-95
                      font-semibold
                      focus-visible:ring-4 focus-visible:ring-cyan-400/40
                    "
                  >
                    <Database size={16} className="mr-2" strokeWidth={2.5} />
                    Connect Database
                  </Button>
                </div>
              ) : (
                <div className="p-4 border-b-2 border-slate-200/60 dark:border-slate-800/60 space-y-2">
                  <Button 
                    onClick={onOpenModal} 
                    variant="outline" 
                    size="sm" 
                    className="
                      w-full h-9 text-sm 
                      border-2 border-indigo-200/60 dark:border-indigo-800/40
                      hover:bg-indigo-50 dark:hover:bg-indigo-950/30
                      hover:border-indigo-300 dark:hover:border-indigo-700
                      rounded-xl transition-all duration-300 
                      active:scale-95
                      font-semibold
                      text-slate-700 dark:text-slate-300
                      focus-visible:ring-4 focus-visible:ring-cyan-400/40
                    "
                  >
                    <RefreshCw size={16} className="mr-2" strokeWidth={2.5} />
                    Switch Database
                  </Button>
                  <Button 
                    onClick={onDisconnect} 
                    variant="outline" 
                    size="sm" 
                    className="
                      w-full h-9 text-sm 
                      border-2 border-red-200/60 dark:border-red-800/40
                      text-red-600 dark:text-red-400 
                      hover:bg-red-50 dark:hover:bg-red-950/30 
                      hover:border-red-300 dark:hover:border-red-700
                      rounded-xl transition-all duration-300 
                      active:scale-95
                      font-semibold
                      focus-visible:ring-4 focus-visible:ring-red-400/40
                    "
                  >
                    <Unplug size={16} className="mr-2" strokeWidth={2.5} />
                    Disconnect
                  </Button>
                </div>
              )}

              {/* Chat history header */}
              <div className="flex items-center justify-between p-4 border-b-2 border-slate-200/60 dark:border-slate-800/60">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 tracking-tight">Chat History</h3>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onNewChat}
                        className="
                          h-8 w-8 p-0 
                          hover:bg-indigo-50 dark:hover:bg-indigo-950/30 
                          rounded-xl transition-all duration-300 
                          active:scale-90
                          focus-visible:ring-4 focus-visible:ring-cyan-400/40
                        "
                      >
                        <Plus size={18} strokeWidth={2.5} className="text-slate-700 dark:text-slate-300" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="
                      bg-slate-900 dark:bg-slate-100 
                      text-white dark:text-slate-900 
                      rounded-xl shadow-2xl
                      border-2 border-slate-700 dark:border-slate-300
                      px-3 py-2
                    ">
                      <p className="text-xs font-bold">New Chat</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              {/* Chat list */}
              <ScrollArea className="flex-1 px-3 custom-sidebar-scroll">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="relative w-10 h-10">
                      <div className="absolute inset-0 border-4 border-indigo-200/20 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-transparent border-t-indigo-500 border-r-violet-500 rounded-full animate-spin"></div>
                    </div>
                  </div>
                ) : safeHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                    <div className="
                      w-16 h-16 rounded-2xl 
                      bg-gradient-to-br from-slate-100 to-slate-200 
                      dark:from-slate-800 dark:to-slate-700 
                      flex items-center justify-center mb-4 
                      shadow-xl
                    ">
                      <MessageSquare size={28} className="text-slate-400 dark:text-slate-600" strokeWidth={2.5} />
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1.5">No conversations yet</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-500 font-medium">Start a chat to see your history here</p>
                  </div>
                ) : (
                  <div className="space-y-1 py-3">
                    {/* Starred section */}
                    {starredChatsList.length > 0 && (
                      <>
                        <div className="px-3 py-2">
                          <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest">
                            Favorites
                          </h4>
                        </div>
                        {starredChatsList.map(renderChatItem)}
                        <div className="h-4" />
                      </>
                    )}
                    
                    {/* Recent section */}
                    {regularChatsList.length > 0 && (
                      <>
                        {starredChatsList.length > 0 && (
                          <div className="px-3 py-2">
                            <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest">
                              Recent
                            </h4>
                          </div>
                        )}
                        {regularChatsList.map(renderChatItem)}
                      </>
                    )}
                  </div>
                )}
              </ScrollArea>
            </>
          )}
        </div>
      </div>

      {/* Resize Handle */}
      {!isCollapsed && (
        <div
          onMouseDown={handleMouseDown}
          className={`
            absolute top-0 right-0 w-1 h-full cursor-col-resize group 
            hover:w-1.5 transition-all duration-150 
            ${isResizing ? 'w-1.5' : ''}
          `}
        >
          {/* Visual indicator */}
          <div className={`
            absolute top-0 right-0 h-full w-1 
            bg-transparent 
            group-hover:bg-indigo-300 dark:group-hover:bg-indigo-600 
            transition-all duration-150 
            ${isResizing ? 'bg-indigo-400 dark:bg-indigo-500' : ''}
          `} />
          
          {/* Hover area (wider for easier grabbing) */}
          <div className="absolute top-0 right-0 h-full w-2 -translate-x-1/2" />
        </div>
      )}

      <style>{`
        /* ============================================
           CUSTOM SIDEBAR SCROLLBAR
           ============================================ */
        .custom-sidebar-scroll::-webkit-scrollbar {
          width: 8px;
        }
        
        .custom-sidebar-scroll::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 100px;
          margin: 8px 0;
        }
        
        .custom-sidebar-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, rgb(79 70 229), rgb(139 92 246));
          border-radius: 100px;
          border: 2px solid transparent;
          background-clip: padding-box;
          box-shadow: 0 0 6px rgba(79, 70, 229, 0.4);
        }
        
        .custom-sidebar-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to bottom, rgb(99 102 241), rgb(167 139 250));
          background-clip: padding-box;
          box-shadow: 0 0 10px rgba(79, 70, 229, 0.6);
        }

        /* Dark mode scrollbar */
        .dark .custom-sidebar-scroll::-webkit-scrollbar-thumb {
          box-shadow: 0 0 6px rgba(79, 70, 229, 0.3);
        }

        .dark .custom-sidebar-scroll::-webkit-scrollbar-thumb:hover {
          box-shadow: 0 0 10px rgba(79, 70, 229, 0.5);
        }
      `}</style>
    </div>
  );
};

export default Sidebar;