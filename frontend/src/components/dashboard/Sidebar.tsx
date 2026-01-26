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
  onRenameChat
}: SidebarProps) => {
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [starredChats, setStarredChats] = useState<Set<string>>(new Set());
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  
  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState<number>(288); // 72 * 4 = 288px (w-72)
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  
  const MIN_WIDTH = 240; // Minimum sidebar width
  const MAX_WIDTH = 480; // Maximum sidebar width
  const COLLAPSED_WIDTH = 64; // w-16 = 64px
  
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

  const handleStarToggle = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarredChats(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chatId)) {
        newSet.delete(chatId);
      } else {
        newSet.add(chatId);
      }
      return newSet;
    });
  };

  const handleRenameClick = (chat: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  };

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
      
      if (onRenameChat) {
        onRenameChat(chatId, editingTitle.trim());
      }
      
      setEditingChatId(null);
      setEditingTitle('');
      
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

  const starredChatsList = safeHistory.filter(chat => starredChats.has(chat.id));
  const regularChatsList = safeHistory.filter(chat => !starredChats.has(chat.id));

  const renderChatItem = (chat: ChatSession) => {
    const isStarred = starredChats.has(chat.id);
    const isEditing = editingChatId === chat.id;

    return (
      <div
        key={chat.id}
        className={`group relative rounded-xl mb-1.5 transition-all duration-200 ${
          currentChatId === chat.id 
            ? 'bg-gradient-to-r from-slate-100/80 to-slate-50/60 dark:from-slate-800/50 dark:to-slate-800/30 shadow-sm' 
            : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/30'
        } ${deletingChatId === chat.id ? 'opacity-40 pointer-events-none' : ''}`}
      >
        <div className="flex items-center justify-between">
          <div
            onClick={() => !isEditing && onChatSelect(chat.id)}
            className="flex-1 cursor-pointer p-3"
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 transition-all duration-200 ${
                currentChatId === chat.id 
                  ? 'text-slate-700 dark:text-slate-300' 
                  : 'text-slate-400 dark:text-slate-600 group-hover:text-slate-600 dark:group-hover:text-slate-400'
              }`}>
                <MessageSquare size={16} strokeWidth={2} />
              </div>
              
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="space-y-2 w-full pr-2" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => handleRenameKeyDown(e, chat.id)}
                      className="h-8 text-sm px-3 py-1.5 w-full border-slate-300 dark:border-slate-600 focus:border-slate-400 dark:focus:border-slate-500 focus:ring-slate-400/20 rounded-lg transition-all duration-200"
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
                        className="h-7 text-xs px-4 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 font-medium shadow-sm"
                      >
                        {isRenaming ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameCancel();
                        }}
                        disabled={isRenaming}
                        className="h-7 text-xs px-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-all duration-200 font-medium"
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
                          className="text-rose-500 fill-rose-500 flex-shrink-0 transition-all duration-200 animate-in zoom-in-50" 
                          strokeWidth={2}
                        />
                      )}
                      <h4 className={`font-medium text-sm truncate transition-colors duration-200 ${
                        currentChatId === chat.id 
                          ? 'text-slate-900 dark:text-slate-100' 
                          : 'text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100'
                      }`}>
                        {chat.title}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-500 truncate mt-1 transition-colors duration-200">
                      {formatTimestamp(chat.timestamp)}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
          
          {/* Three-dot menu with enhanced hover effect */}
          {!isEditing && (
            <div className="flex-shrink-0 pr-2 opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div
                    className="h-8 w-8 flex items-center justify-center hover:bg-slate-200/60 dark:hover:bg-slate-700/60 rounded-lg cursor-pointer transition-all duration-200 active:scale-95"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical size={16} className="text-slate-600 dark:text-slate-400" strokeWidth={2} />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-lg border-slate-200 dark:border-slate-700">
                  <DropdownMenuItem
                    onClick={(e) => handleStarToggle(chat.id, e)}
                    className="text-sm cursor-pointer rounded-lg transition-all duration-150 focus:bg-slate-100 dark:focus:bg-slate-800"
                  >
                    <Heart 
                      size={16} 
                      className={`mr-3 transition-all duration-200 ${isStarred ? 'fill-rose-500 text-rose-500' : 'text-slate-600 dark:text-slate-400'}`}
                      strokeWidth={2}
                    />
                    {isStarred ? 'Unfavorite' : 'Favorite'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => handleRenameClick(chat, e)}
                    className="text-sm cursor-pointer rounded-lg transition-all duration-150 focus:bg-slate-100 dark:focus:bg-slate-800"
                  >
                    <PenLine size={16} className="mr-3 text-slate-600 dark:text-slate-400" strokeWidth={2} />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-slate-200 dark:bg-slate-700" />
                  <DropdownMenuItem
                    onClick={(e) => handleDeleteChat(chat.id, e)}
                    disabled={deletingChatId === chat.id}
                    className="text-rose-600 dark:text-rose-400 text-sm cursor-pointer rounded-lg transition-all duration-150 focus:bg-rose-50 dark:focus:bg-rose-950/30"
                  >
                    <Trash2 size={16} className="mr-3" strokeWidth={2} />
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
      className={`relative h-full bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex-shrink-0`}
    >
      <div className="flex flex-col h-full">
        {/* Header with menu toggle */}
        <div className="flex items-center justify-end p-4 border-b border-slate-200 dark:border-slate-800">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all duration-200 active:scale-95"
          >
            <Menu size={20} strokeWidth={2} className="text-slate-700 dark:text-slate-300" />
          </Button>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {!isCollapsed && (
            <>
              {/* Connection status */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5 text-sm">
                  <div className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    isConnected 
                      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' 
                      : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'
                  }`}></div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium">
                    {isConnected ? 'Database Connected' : 'No Connection'}
                  </span>
                </div>
              </div>

              {/* Database connection buttons */}
              {!isConnected ? (
                <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                  <Button 
                    onClick={onOpenModal} 
                    size="sm" 
                    className="w-full h-10 text-sm bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg transition-all duration-200 shadow-sm active:scale-98 font-medium"
                  >
                    <Database size={16} className="mr-2" strokeWidth={2} />
                    Connect Database
                  </Button>
                </div>
              ) : (
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2">
                  <Button 
                    onClick={onOpenModal} 
                    variant="outline" 
                    size="sm" 
                    className="w-full h-9 text-sm border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all duration-200 active:scale-98 font-medium"
                  >
                    <RefreshCw size={16} className="mr-2" strokeWidth={2} />
                    Switch Database
                  </Button>
                  <Button 
                    onClick={onDisconnect} 
                    variant="outline" 
                    size="sm" 
                    className="w-full h-9 text-sm border-slate-300 dark:border-slate-700 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:border-rose-300 dark:hover:border-rose-800 rounded-lg transition-all duration-200 active:scale-98 font-medium"
                  >
                    <Unplug size={16} className="mr-2" strokeWidth={2} />
                    Disconnect
                  </Button>
                </div>
              )}

              {/* Chat history header */}
              <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Chat History</h3>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onNewChat}
                        className="h-8 w-8 p-0 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all duration-200 active:scale-95"
                      >
                        <Plus size={18} strokeWidth={2} className="text-slate-700 dark:text-slate-300" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg shadow-lg">
                      <p className="text-xs font-medium">New Chat</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              
              {/* Chat list */}
              <ScrollArea className="flex-1 px-3">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-300 dark:border-slate-700 border-t-slate-900 dark:border-t-slate-100"></div>
                  </div>
                ) : safeHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4 shadow-sm">
                      <MessageSquare size={24} className="text-slate-400 dark:text-slate-600" strokeWidth={2} />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1.5">No conversations yet</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-500">Start a chat to see your history here</p>
                  </div>
                ) : (
                  <div className="space-y-1 py-3">
                    {/* Starred section */}
                    {starredChatsList.length > 0 && (
                      <>
                        <div className="px-3 py-2">
                          <h4 className="text-[11px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-wider">
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
                            <h4 className="text-[11px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-wider">
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
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize group hover:w-1.5 transition-all duration-150 ${
            isResizing ? 'w-1.5' : ''
          }`}
        >
          {/* Visual indicator */}
          <div className={`absolute top-0 right-0 h-full w-1 bg-transparent group-hover:bg-slate-300 dark:group-hover:bg-slate-600 transition-all duration-150 ${
            isResizing ? 'bg-slate-400 dark:bg-slate-500' : ''
          }`} />
          
          {/* Hover area (wider for easier grabbing) */}
          <div className="absolute top-0 right-0 h-full w-2 -translate-x-1/2" />
        </div>
      )}
    </div>
  );
};

export default Sidebar;
