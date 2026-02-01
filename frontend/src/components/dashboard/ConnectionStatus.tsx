import React, { useState, useEffect } from 'react';
import { Database, CheckCircle2, ChevronDown, Power, X, Table, Key, Clock, Activity, Hash, Type, Calendar, ToggleLeft } from 'lucide-react';

interface TableSchema {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    key?: string;
    nullable?: boolean;
    default?: string;
    autoincrement?: boolean;
  }>;
}

interface ConnectionStatusProps {
  isConnected: boolean;
  databaseName?: string;
  dbType?: string;
  onSwitchDatabase?: () => void;
  onDisconnect?: () => void;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ 
  isConnected, 
  databaseName = "database",
  dbType,
  onSwitchDatabase,
  onDisconnect
}) => {
  const [showModal, setShowModal] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTableSchemas, setExpandedTableSchemas] = useState<Map<string, TableSchema>>(new Map());
  const [loadingSchemas, setLoadingSchemas] = useState<Set<string>>(new Set());
  const [connectionTime, setConnectionTime] = useState<Date>(new Date());
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isConnected) {
      setConnectionTime(new Date());
      setTables([]);
      setExpandedTableSchemas(new Map());
      setLoadingSchemas(new Set());
      setError(null);
      fetchTables();
    } else {
      setTables([]);
      setError(null);
      setShowModal(false);
      setExpandedTableSchemas(new Map());
      setLoadingSchemas(new Set());
    }
  }, [isConnected, databaseName]);

  useEffect(() => {
    if (!isConnected) return;
    
    const handleRefresh = () => {
      fetchTables();
    };
    
    window.addEventListener('refreshDatabaseSchema', handleRefresh);
    
    return () => {
      window.removeEventListener('refreshDatabaseSchema', handleRefresh);
    };
  }, [isConnected]);

  const fetchTables = async () => {
    setIsLoadingTables(true);
    setError(null);
    
    try {
      const response = await fetch('http://localhost:8000/api/tables', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.tables) {
          setTables(data.tables);
          return;
        }
      }
      
      const fallbackResponse = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: 'SHOW TABLES',
          chat_history: []
        }),
      });

      if (!fallbackResponse.ok) {
        throw new Error('Failed to fetch tables');
      }

      const fallbackData = await fallbackResponse.json();
      
      if (fallbackData.success && fallbackData.response) {
        const outputMatch = fallbackData.response.match(/Output:\s*({.+})/s);
        if (outputMatch) {
          const output = JSON.parse(outputMatch[1]);
          if (output.type === 'select' && output.data) {
            const tableNames = output.data.map((row: string[]) => row[0]);
            setTables(tableNames);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching tables:', err);
      setError('Failed to load tables');
      setTables([]);
    } finally {
      setIsLoadingTables(false);
    }
  };

  const fetchTableSchema = async (tableName: string) => {
    try {
      const response = await fetch(`http://localhost:8000/api/table-schema/${encodeURIComponent(tableName)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.columns) {
          return { 
            name: tableName, 
            columns: data.columns 
          };
        }
      }
      
      const fallbackResponse = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: `DESCRIBE \`${tableName}\``,
          chat_history: []
        }),
      });

      if (!fallbackResponse.ok) {
        throw new Error('Failed to fetch schema');
      }

      const fallbackData = await fallbackResponse.json();
      
      if (fallbackData.success && fallbackData.response) {
        const outputMatch = fallbackData.response.match(/Output:\s*({.+})/s);
        if (outputMatch) {
          const output = JSON.parse(outputMatch[1]);
          
          if (output.type === 'select' && output.data) {
            const columns = output.data.map((row: any[]) => ({
              name: row[0],
              type: row[1],
              nullable: row[2] === 'YES',
              key: row[3] || null,
              default: row[4],
              autoincrement: row[5]?.includes('auto_increment') || false
            }));
            
            return { name: tableName, columns };
          }
        }
      }
      
      return null;
    } catch (err) {
      console.error(`Error fetching schema for ${tableName}:`, err);
      return null;
    }
  };

  const handleTableClick = async (tableName: string) => {
    if (expandedTableSchemas.has(tableName)) {
      const newSchemas = new Map(expandedTableSchemas);
      newSchemas.delete(tableName);
      setExpandedTableSchemas(newSchemas);
      return;
    }

    setLoadingSchemas(new Set(loadingSchemas).add(tableName));
    
    const schema = await fetchTableSchema(tableName);
    
    if (schema) {
      const newSchemas = new Map(expandedTableSchemas);
      newSchemas.set(tableName, schema);
      setExpandedTableSchemas(newSchemas);
    }
    
    const newLoading = new Set(loadingSchemas);
    newLoading.delete(tableName);
    setLoadingSchemas(newLoading);
  };

  const handleOpenModal = () => {
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setExpandedTableSchemas(new Map());
    setLoadingSchemas(new Set());
  };

  const getTimeAgo = (date: Date): string => {
    const seconds = Math.floor((currentTime.getTime() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const getDbTypeStyle = (type?: string) => {
    if (!type) return null;
    
    const lowerType = type.toLowerCase();
    
    if (lowerType === 'mysql') {
      return {
        label: 'MySQL',
        emoji: '🐬',
        gradient: 'from-amber-500/20 via-orange-500/20 to-rose-500/20',
        border: 'border-amber-400/30 dark:border-amber-600/20',
        text: 'text-amber-200 dark:text-amber-300',
        shadow: 'shadow-[inset_0_1px_0_0_rgba(251,191,36,0.1)]'
      };
    }
    
    if (lowerType === 'postgresql') {
      return {
        label: 'PostgreSQL',
        emoji: '🐘',
        gradient: 'from-sky-500/20 via-blue-500/20 to-indigo-500/20',
        border: 'border-sky-400/30 dark:border-sky-600/20',
        text: 'text-sky-200 dark:text-sky-300',
        shadow: 'shadow-[inset_0_1px_0_0_rgba(56,189,248,0.1)]'
      };
    }
    
    return null;
  };

  const getTypeIcon = (type: string) => {
    const lowerType = type.toLowerCase();
    
    if (lowerType.includes('int') || lowerType.includes('decimal') || lowerType.includes('float') || lowerType.includes('double')) {
      return { 
        icon: Hash, 
        gradient: 'from-blue-500/10 to-indigo-500/10',
        border: 'border-blue-400/20',
        text: 'text-blue-400 dark:text-blue-300',
        shadow: 'shadow-[inset_0_1px_0_0_rgba(59,130,246,0.1)]'
      };
    }
    if (lowerType.includes('char') || lowerType.includes('text') || lowerType.includes('varchar')) {
      return { 
        icon: Type, 
        gradient: 'from-violet-500/10 to-purple-500/10',
        border: 'border-violet-400/20',
        text: 'text-violet-400 dark:text-violet-300',
        shadow: 'shadow-[inset_0_1px_0_0_rgba(139,92,246,0.1)]'
      };
    }
    if (lowerType.includes('date') || lowerType.includes('time')) {
      return { 
        icon: Calendar, 
        gradient: 'from-amber-500/10 to-orange-500/10',
        border: 'border-amber-400/20',
        text: 'text-amber-400 dark:text-amber-300',
        shadow: 'shadow-[inset_0_1px_0_0_rgba(245,158,11,0.1)]'
      };
    }
    if (lowerType.includes('bool') || lowerType.includes('bit')) {
      return { 
        icon: ToggleLeft, 
        gradient: 'from-emerald-500/10 to-teal-500/10',
        border: 'border-emerald-400/20',
        text: 'text-emerald-400 dark:text-emerald-300',
        shadow: 'shadow-[inset_0_1px_0_0_rgba(16,185,129,0.1)]'
      };
    }
    return { 
      icon: Database, 
      gradient: 'from-slate-500/10 to-slate-600/10',
      border: 'border-slate-400/20',
      text: 'text-slate-400 dark:text-slate-300',
      shadow: 'shadow-[inset_0_1px_0_0_rgba(100,116,139,0.1)]'
    };
  };

  if (!isConnected) return null;

  const tableCount = tables.length;
  const dbTypeStyle = getDbTypeStyle(dbType);

  return (
    <>
      {/* ===== MAIN CONNECTION STATUS BUTTON ===== */}
      <div className="w-full group/status">
        <button
          onClick={handleOpenModal}
          className="
            w-full relative overflow-hidden
            flex items-center gap-3.5 px-6 py-4
            bg-white dark:bg-slate-900
            rounded-2xl
            border-2 border-indigo-200/30 dark:border-indigo-800/30
            shadow-[0_8px_32px_rgba(79,70,229,0.12)]
            hover:shadow-[0_12px_48px_rgba(79,70,229,0.20)]
            hover:border-indigo-300/50 dark:hover:border-indigo-700/50
            transition-all duration-500 ease-out
            hover:-translate-y-1
            focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-400/40 focus-visible:ring-offset-2
            active:scale-[0.99]
          "
          aria-label="View database connection details"
        >
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/[0.02] via-violet-500/[0.04] to-indigo-500/[0.02] opacity-0 group-hover/status:opacity-100 transition-opacity duration-500"></div>

          {/* Sweep animation */}
          <div className="absolute inset-0 -translate-x-full group-hover/status:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-indigo-400/10 to-transparent"></div>
          
          <div className="relative flex items-center gap-3.5 flex-1 min-w-0 z-10">
            {/* Active pulse indicator */}
            <div className="relative flex-shrink-0">
              <div className="w-3 h-3 bg-cyan-400 rounded-full shadow-[0_0_20px_rgba(6,182,212,0.8)]"></div>
              <div className="absolute inset-0 w-3 h-3 bg-cyan-400/60 rounded-full animate-ping"></div>
              <div className="absolute inset-[-4px] w-5 h-5 bg-cyan-400/20 rounded-full animate-pulse"></div>
            </div>
            
            {/* Connection info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-50 truncate tracking-tight">
                  Connected to {databaseName}
                </span>
                <ChevronDown className="
                  relative z-10 h-5 w-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0
                  transform transition-all duration-300
                  group-hover/status:translate-y-1 group-hover/status:scale-110
                " />
              </div>
              <div className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400">
                {isLoadingTables ? (
                  <span className="flex items-center gap-1.5">
                    <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="font-medium">Loading tables...</span>
                  </span>
                ) : error ? (
                  <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                    <X className="w-3 h-3" />
                    <span className="font-medium">Error loading tables</span>
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                      {tableCount} tables available
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {getTimeAgo(connectionTime)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* ===== MODAL ===== */}
      {showModal && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-50 p-4 animate-fadeIn"
          onClick={handleCloseModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div 
            className="
              bg-white dark:bg-slate-900
              rounded-3xl shadow-2xl
              max-w-4xl w-full max-h-[92vh]
              overflow-hidden
              border border-slate-200/50 dark:border-slate-700/50
              animate-scaleIn
            "
            onClick={(e) => e.stopPropagation()}
          >
            {/* ===== PREMIUM HEADER ===== */}
            <div className="relative bg-gradient-to-br from-slate-900 via-indigo-900 to-violet-900 dark:from-slate-950 dark:via-indigo-950 dark:to-violet-950 p-8 overflow-hidden">
              {/* Neural network pattern */}
              <div className="absolute inset-0 opacity-[0.15]">
                <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <pattern id="neural-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <circle cx="20" cy="20" r="1.5" fill="#6366F1" opacity="0.5"/>
                      <line x1="20" y1="20" x2="60" y2="20" stroke="#8B5CF6" strokeWidth="0.5" opacity="0.3"/>
                      <line x1="20" y1="20" x2="20" y2="60" stroke="#8B5CF6" strokeWidth="0.5" opacity="0.3"/>
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#neural-grid)"/>
                </svg>
              </div>

              {/* Film grain texture */}
              <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none" 
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'repeat',
                  backgroundSize: '128px'
                }}>
              </div>

              <div className="relative flex items-start gap-5">
                {/* Database icon with glassmorphism */}
                <div className="
                  relative bg-white/10 dark:bg-white/5 p-4 rounded-2xl
                  backdrop-blur-xl shadow-2xl
                  border border-white/20
                  group/icon hover:scale-110 transition-transform duration-300
                ">
                  <Database className="h-8 w-8 text-white" strokeWidth={2.5} />
                  <div className="absolute inset-0 bg-white/10 rounded-2xl opacity-0 group-hover/icon:opacity-100 transition-opacity duration-300"></div>
                </div>
                
                {/* Title and stats */}
                <div className="flex-1 min-w-0">
                  <h2 id="modal-title" className="text-3xl font-black text-white mb-3 tracking-tight">
                    {databaseName}
                  </h2>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="
                      flex items-center gap-2 
                      bg-white/10 dark:bg-white/5
                      backdrop-blur-md px-3 py-1.5 rounded-xl
                      border border-white/20
                      shadow-lg
                    ">
                      <Activity className="h-4 w-4 text-white" strokeWidth={2.5} />
                      <span className="text-sm font-bold text-white">Active Connection</span>
                    </div>

                    {/* Database Type Badge */}
                    {dbTypeStyle && (
                      <div className={`
                        flex items-center gap-2 
                        bg-gradient-to-br ${dbTypeStyle.gradient}
                        backdrop-blur-md px-3 py-1.5 rounded-xl
                        border ${dbTypeStyle.border}
                        ${dbTypeStyle.shadow}
                      `}>
                        <span className="text-base">{dbTypeStyle.emoji}</span>
                        <span className={`text-sm font-bold ${dbTypeStyle.text}`}>{dbTypeStyle.label}</span>
                      </div>
                    )}

                    <div className="
                      flex items-center gap-2 
                      bg-white/10 dark:bg-white/5
                      backdrop-blur-md px-3 py-1.5 rounded-xl
                      border border-white/20
                      shadow-lg
                    ">
                      <Table className="h-4 w-4 text-white" strokeWidth={2.5} />
                      <span className="text-sm font-bold text-white">{tableCount} Tables</span>
                    </div>

                    <div className="
                      flex items-center gap-2 
                      bg-white/10 dark:bg-white/5
                      backdrop-blur-md px-3 py-1.5 rounded-xl
                      border border-white/20
                      shadow-lg
                    ">
                      <Clock className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                      <span className="text-sm font-bold text-white">{getTimeAgo(connectionTime)}</span>
                    </div>
                  </div>
                </div>
                
                {/* Close button */}
                <button
                  onClick={handleCloseModal}
                  className="
                    relative bg-white/10 hover:bg-white/20 backdrop-blur-md
                    p-3 rounded-xl transition-all duration-300
                    hover:rotate-90 hover:scale-110
                    border border-white/20
                    shadow-lg
                    group/close
                    focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-400/40
                  "
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5 text-white" strokeWidth={3} />
                  <div className="absolute inset-0 bg-white/10 rounded-xl opacity-0 group-hover/close:opacity-100 transition-opacity duration-300"></div>
                </button>
              </div>
            </div>

            {/* ===== MODAL CONTENT ===== */}
            <div className="p-8 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/50 dark:to-slate-900/50">
              {/* Section Header */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-2xl font-bold bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 dark:from-slate-50 dark:via-indigo-100 dark:to-slate-50 bg-clip-text text-transparent mb-1 tracking-tight">
                      Database Schema
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">
                      Explore {tableCount} {tableCount === 1 ? 'table' : 'tables'} and their structure
                    </p>
                  </div>
                </div>
              </div>

              {/* Tables List */}
              {isLoadingTables ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="relative w-16 h-16 mb-4">
                    <div className="absolute inset-0 border-4 border-indigo-200/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-transparent border-t-indigo-500 border-r-violet-500 rounded-full animate-spin"></div>
                  </div>
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Loading tables...</p>
                  <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">Please wait</p>
                </div>
              ) : error ? (
                <div className="
                  text-center py-16 px-6 
                  bg-gradient-to-br from-red-50 to-red-100/50 
                  dark:from-red-950/20 dark:to-red-900/10 
                  rounded-2xl border-2 border-red-200 dark:border-red-800/30
                ">
                  <div className="w-16 h-16 bg-gradient-to-br from-red-500 to-rose-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-red-500/30">
                    <X className="w-8 h-8 text-white" strokeWidth={3} />
                  </div>
                  <h4 className="text-lg font-bold text-red-900 dark:text-red-100 mb-2">Connection Error</h4>
                  <p className="text-sm text-red-700 dark:text-red-300 font-medium">{error}</p>
                </div>
              ) : tableCount === 0 ? (
                <div className="text-center py-20 px-6">
                  <div className="w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl">
                    <Database className="w-10 h-10 text-slate-400 dark:text-slate-500" strokeWidth={2} />
                  </div>
                  <h4 className="text-xl font-bold text-slate-900 dark:text-slate-50 mb-2">No Tables Found</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400">This database is empty. Create your first table to get started.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-3 custom-scrollbar">
                  {tables.map((table, index) => {
                    const isExpanded = expandedTableSchemas.has(table);
                    const isLoading = loadingSchemas.has(table);
                    const schema = expandedTableSchemas.get(table);

                    return (
                      <div 
                        key={table}
                        className="
                          group/table 
                          bg-white dark:bg-slate-800/50 
                          rounded-2xl 
                          border-2 border-slate-200/60 dark:border-slate-700/50
                          overflow-hidden 
                          hover:border-indigo-300/50 dark:hover:border-indigo-700/40
                          hover:shadow-[0_8px_32px_rgba(79,70,229,0.15)]
                          transition-all duration-500
                          animate-slideInStagger
                        "
                        style={{ animationDelay: `${index * 30}ms` }}
                      >
                        {/* Table Header */}
                        <button
                          onClick={() => handleTableClick(table)}
                          className="
                            w-full flex items-center gap-4 px-6 py-4
                            hover:bg-gradient-to-r 
                            hover:from-indigo-500/[0.03] hover:via-violet-500/[0.05] hover:to-indigo-500/[0.03]
                            dark:hover:from-indigo-400/[0.02] dark:hover:via-violet-400/[0.04] dark:hover:to-indigo-400/[0.02]
                            transition-all duration-500
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset
                            relative overflow-hidden
                          "
                          aria-expanded={isExpanded}
                        >
                          {/* Sweep animation */}
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-indigo-400/5 to-transparent translate-x-[-100%] group-hover/table:translate-x-[100%] transition-transform duration-700 ease-out pointer-events-none"></div>

                          {/* Icon */}
                          <div className="
                            relative w-12 h-12 
                            bg-gradient-to-br from-indigo-500 to-violet-500 
                            rounded-xl flex items-center justify-center flex-shrink-0
                            shadow-lg shadow-indigo-500/30
                            group-hover/table:scale-110 group-hover/table:rotate-3
                            transition-all duration-300
                          ">
                            <Table className="h-6 w-6 text-white" strokeWidth={2.5} />
                            <div className="absolute inset-0 bg-white/10 rounded-xl opacity-0 group-hover/table:opacity-100 transition-opacity duration-300"></div>
                          </div>
                          
                          {/* Table Info */}
                          <div className="flex-1 min-w-0 text-left">
                            <h4 className="font-mono text-base font-bold text-indigo-700 dark:text-indigo-300 truncate mb-0.5 tracking-tight">
                              {table}
                            </h4>
                            {schema && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                {schema.columns.length} columns • {schema.columns.filter(c => c.key === 'PRI').length} primary keys
                              </p>
                            )}
                          </div>
                          
                          {/* Status Indicator */}
                          {isLoading ? (
                            <div className="w-6 h-6 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <ChevronDown 
                              className={`
                                h-6 w-6 text-slate-400 dark:text-slate-500
                                transition-all duration-500
                                ${isExpanded ? 'rotate-180 text-indigo-500 scale-110' : 'group-hover/table:translate-y-1'}
                              `}
                              strokeWidth={2.5}
                            />
                          )}
                        </button>

                        {/* Table Schema - Expanded */}
                        {isExpanded && schema && (
                          <div className="
                            px-6 pb-5 pt-2
                            bg-gradient-to-br from-slate-50 to-slate-100/50
                            dark:from-slate-900/50 dark:to-slate-800/50
                            border-t-2 border-slate-200/60 dark:border-slate-700/50
                            animate-expandDown
                          ">
                            {/* Column Headers */}
                            <div className="
                              grid grid-cols-[2fr_1fr_1fr] gap-3
                              px-4 py-3 mb-2
                              bg-white/60 dark:bg-slate-800/60
                              rounded-xl
                              border border-slate-200 dark:border-slate-700
                            ">
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                Column Name
                              </span>
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 text-center">
                                DataType
                              </span>
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 text-right">
                                Constraints
                              </span>
                            </div>

                            {/* Columns List */}
                            <div className="space-y-2">
                              {schema.columns.map((column, idx) => {
                                const typeInfo = getTypeIcon(column.type);
                                const TypeIcon = typeInfo.icon;
                                
                                return (
                                  <div 
                                    key={idx}
                                    className="
                                      group/column
                                      grid grid-cols-[2fr_1fr_1fr] gap-3 items-center
                                      px-4 py-3 rounded-xl
                                      bg-white dark:bg-slate-800/50
                                      border-2 border-slate-200/60 dark:border-slate-700/50
                                      hover:border-indigo-300/50 dark:hover:border-indigo-700/40
                                      hover:shadow-lg hover:shadow-indigo-500/10
                                      transition-all duration-300
                                      animate-slideInStagger
                                    "
                                    style={{ animationDelay: `${idx * 20}ms` }}
                                  >
                                    {/* Column Name with Icon */}
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className={`
                                        w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
                                        bg-gradient-to-br ${typeInfo.gradient}
                                        border ${typeInfo.border}
                                        ${typeInfo.shadow}
                                        group-hover/column:scale-110 transition-transform duration-300
                                      `}>
                                        <TypeIcon className={`w-4 h-4 ${typeInfo.text}`} strokeWidth={2.5} />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-50 block truncate">
                                          {column.name}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Data Type */}
                                    <div className="flex justify-center">
                                      <span className="
                                        px-3 py-1.5 rounded-lg text-xs font-mono font-bold
                                        bg-slate-100 dark:bg-slate-900/50
                                        text-slate-700 dark:text-slate-300
                                        border border-slate-200 dark:border-slate-700
                                        whitespace-nowrap
                                      ">
                                        {column.type.toLowerCase()}
                                      </span>
                                    </div>

                                    {/* Key Badges */}
                                    <div className="flex items-center gap-1.5 justify-end">
                                      {column.key === 'PRI' && (
                                        <span className="
                                          relative overflow-hidden
                                          px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg
                                          bg-gradient-to-br from-pink-500/20 via-rose-500/20 to-pink-600/20
                                          text-pink-100 dark:text-pink-200
                                          border-2 border-pink-400/40 dark:border-pink-500/30
                                          shadow-[0_0_24px_rgba(236,72,153,0.25)]
                                          backdrop-blur-sm
                                          flex items-center gap-1.5
                                        ">
                                          <Key className="w-3 h-3" strokeWidth={3} />
                                          PK
                                          {/* Shimmer effect */}
                                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-shimmer"></div>
                                        </span>
                                      )}
                                      {column.key === 'MUL' && (
                                        <span className="
                                          px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg
                                          bg-gradient-to-br from-blue-500/20 via-indigo-500/20 to-blue-600/20
                                          text-blue-100 dark:text-blue-200
                                          border-2 border-blue-400/40 dark:border-blue-500/30
                                          shadow-[0_0_16px_rgba(59,130,246,0.2)]
                                          backdrop-blur-sm
                                        ">
                                          FK
                                        </span>
                                      )}
                                      {column.key === 'UNI' && (
                                        <span className="
                                          px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg
                                          bg-gradient-to-br from-violet-500/20 via-purple-500/20 to-violet-600/20
                                          text-violet-100 dark:text-violet-200
                                          border-2 border-violet-400/40 dark:border-violet-500/30
                                          shadow-[0_0_16px_rgba(139,92,246,0.2)]
                                          backdrop-blur-sm
                                        ">
                                          UNQ
                                        </span>
                                      )}
                                      {!column.nullable && !column.key && (
                                        <span className="
                                          px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg
                                          bg-slate-100 dark:bg-slate-800
                                          text-slate-600 dark:text-slate-400
                                          border-2 border-slate-200 dark:border-slate-700
                                        ">
                                          NOT NULL
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ===== PREMIUM ACTION BUTTONS ===== */}
              <div className="mt-8 pt-6 border-t-2 border-slate-200 dark:border-slate-700 flex gap-3">
                {onSwitchDatabase && (
                  <button 
                    onClick={() => {
                      handleCloseModal();
                      onSwitchDatabase();
                    }}
                    className="
                      group/btn flex-1 relative overflow-hidden
                      flex items-center justify-center gap-3
                      px-6 py-4 rounded-xl
                      text-sm font-bold
                      bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-700
                      hover:from-indigo-500 hover:via-violet-500 hover:to-indigo-600
                      text-white
                      shadow-[0_8px_32px_rgba(79,70,229,0.35)]
                      hover:shadow-[0_12px_48px_rgba(79,70,229,0.45)]
                      hover:scale-105
                      active:scale-[0.97]
                      transition-all duration-300
                      focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-400/40
                    "
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700"></div>
                    <Database className="h-5 w-5 relative z-10 group-hover/btn:rotate-12 transition-transform duration-300" strokeWidth={2.5} />
                    <span className="relative z-10">Switch Database</span>
                  </button>
                )}
                
                {onDisconnect && (
                  <button 
                    onClick={() => {
                      handleCloseModal();
                      onDisconnect();
                    }}
                    className="
                      group/btn flex-1 relative overflow-hidden
                      flex items-center justify-center gap-3
                      px-6 py-4 rounded-xl
                      text-sm font-bold
                      bg-gradient-to-r from-red-600 via-rose-600 to-red-700
                      hover:from-red-500 hover:via-rose-500 hover:to-red-600
                      text-white
                      shadow-[0_8px_32px_rgba(239,68,68,0.35)]
                      hover:shadow-[0_12px_48px_rgba(239,68,68,0.45)]
                      hover:scale-105
                      active:scale-[0.97]
                      transition-all duration-300
                      focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-400/40
                    "
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700"></div>
                    <Power className="h-5 w-5 relative z-10 group-hover/btn:rotate-180 transition-transform duration-500" strokeWidth={2.5} />
                    <span className="relative z-10">Disconnect</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* ============================================
           WORLD-CLASS ANIMATIONS
           ============================================ */
        
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.90) translateY(20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        @keyframes expandDown {
          from {
            opacity: 0;
            max-height: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            max-height: 2000px;
            transform: translateY(0);
          }
        }

        @keyframes slideInStagger {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }

        .animate-scaleIn {
          animation: scaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .animate-expandDown {
          animation: expandDown 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .animate-slideInStagger {
          animation: slideInStagger 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .animate-shimmer {
          animation: shimmer 2s infinite;
        }

        /* ============================================
           PREMIUM INDIGO SCROLLBAR
           ============================================ */
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
        }
        
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 100px;
          margin: 8px 0;
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, rgb(79 70 229), rgb(139 92 246));
          border-radius: 100px;
          border: 2px solid transparent;
          background-clip: padding-box;
          box-shadow: 0 0 8px rgba(79, 70, 229, 0.5);
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to bottom, rgb(99 102 241), rgb(167 139 250));
          background-clip: padding-box;
          box-shadow: 0 0 12px rgba(79, 70, 229, 0.7);
        }

        /* Dark mode scrollbar */
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          box-shadow: 0 0 8px rgba(79, 70, 229, 0.3);
        }

        .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          box-shadow: 0 0 12px rgba(79, 70, 229, 0.5);
        }

        /* ============================================
           ACCESSIBILITY ENHANCEMENTS
           ============================================ */
        
        /* Focus visible for keyboard navigation */
        *:focus-visible {
          outline: 3px solid rgb(6 182 212);
          outline-offset: 3px;
        }

        /* Reduced motion support */
        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }

        /* High contrast mode support */
        @media (prefers-contrast: high) {
          .border-indigo-200 {
            border-color: rgb(79 70 229);
            border-width: 3px;
          }
          
          .text-slate-600 {
            color: rgb(0 0 0);
          }
          
          .dark .text-slate-400 {
            color: rgb(255 255 255);
          }
        }
      `}</style>
    </>
  );
};

export default ConnectionStatus;
