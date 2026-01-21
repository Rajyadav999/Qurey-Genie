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
  onSwitchDatabase?: () => void;
  onDisconnect?: () => void;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ 
  isConnected, 
  databaseName = "database",
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

  
  const getTypeIcon = (type: string) => {
    const lowerType = type.toLowerCase();
    
    if (lowerType.includes('int') || lowerType.includes('decimal') || lowerType.includes('float') || lowerType.includes('double')) {
      return { icon: Hash, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/30' };
    }
    if (lowerType.includes('char') || lowerType.includes('text') || lowerType.includes('varchar')) {
      return { icon: Type, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/30' };
    }
    if (lowerType.includes('date') || lowerType.includes('time')) {
      return { icon: Calendar, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30' };
    }
    if (lowerType.includes('bool') || lowerType.includes('bit')) {
      return { icon: ToggleLeft, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' };
    }
    return { icon: Database, color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-900/30' };
  };

  if (!isConnected) return null;

  const tableCount = tables.length;

  return (
    <>
      
      <div className="w-full group/status">
        <button
          onClick={handleOpenModal}
          className="
            w-full relative overflow-hidden
            flex items-center gap-3.5 px-5 py-3.5
            bg-white dark:bg-gray-900
            rounded-2xl
            border-2 border-emerald-200/60 dark:border-emerald-800/40
            shadow-lg shadow-emerald-500/10 dark:shadow-emerald-500/5
            hover:shadow-xl hover:shadow-emerald-500/20 dark:hover:shadow-emerald-500/10
            hover:border-emerald-300 dark:hover:border-emerald-700
            transition-all duration-500 ease-out
            hover:-translate-y-0.5
            focus:outline-none focus:ring-4 focus:ring-emerald-500/20
          "
          aria-label="View database connection details"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 via-teal-500/5 to-cyan-500/5 opacity-0 group-hover/status:opacity-100 transition-opacity duration-500"></div>

          <div className="absolute inset-0 -translate-x-full group-hover/status:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          
          <div className="relative flex items-center gap-3.5 flex-1 min-w-0 z-10">
            <div className="relative flex-shrink-0">
              <div className="w-3 h-3 bg-emerald-500 rounded-full shadow-lg shadow-emerald-500/50"></div>
              <div className="absolute inset-0 w-3 h-3 bg-emerald-400 rounded-full animate-ping"></div>
              <div className="absolute inset-[-4px] w-5 h-5 bg-emerald-500/20 rounded-full animate-pulse"></div>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1">
                <span className="text-sm font-bold text-gray-900 dark:text-gray-50 truncate tracking-tight">
                 Connected to {databaseName}
                </span> 

              {/*use this to remove check icon*/ }
                  <ChevronDown className="
            relative z-10 h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0
            transform transition-all duration-300
            group-hover/status:translate-y-1 group-hover/status:scale-110
          " />

              </div>
              <div className="flex items-center gap-2.5 text-xs text-gray-600 dark:text-gray-400">
                {isLoadingTables ? (
                  <span className="flex items-center gap-1.5">
                    <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="font-medium">Loading tables...</span>
                  </span>
                ) : error ? (
                  <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                    <X className="w-3 h-3" />
                    <span className="font-medium">Error loading tables</span>
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-gray-100">  
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

    
      {showModal && (
        <div 
          className="fixed inset-0 bg-gradient-to-br from-black/70 via-black/60 to-black/70 backdrop-blur-xl flex items-center justify-center z-50 p-4 animate-fadeIn"
          onClick={handleCloseModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div 
            className="
              bg-white dark:bg-gray-900
              rounded-3xl shadow-2xl
              max-w-4xl w-full max-h-[92vh]
              overflow-hidden
              border border-gray-200/50 dark:border-gray-700/50
              animate-scaleIn
            "
            onClick={(e) => e.stopPropagation()}
          >
            {/* ===== PREMIUM HEADER ===== */}
            <div className="relative bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 p-8 overflow-hidden">
              {/* Animated mesh gradient background */}
              <div className="absolute inset-0 opacity-30">
                <div className="absolute top-0 left-0 w-72 h-72 bg-emerald-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
                <div className="absolute top-0 right-0 w-72 h-72 bg-teal-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
                <div className="absolute bottom-0 left-1/2 w-72 h-72 bg-cyan-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
              </div>
              
              {/* Dot pattern overlay */}
              <div className="absolute inset-0 opacity-10" style={{
                backgroundImage: `radial-gradient(circle, white 1px, transparent 1px)`,
                backgroundSize: '24px 24px'
              }}></div>

              <div className="relative flex items-start gap-5">
                {/* Database icon with glassmorphism */}
                <div className="
                  relative bg-white/20 dark:bg-white/10 p-4 rounded-2xl
                  backdrop-blur-xl shadow-2xl
                  border border-white/30
                  group/icon hover:scale-110 transition-transform duration-300
                ">
                  <Database className="h-8 w-8 text-white" strokeWidth={2.5} />
                  <div className="absolute inset-0 bg-white/20 rounded-2xl opacity-0 group-hover/icon:opacity-100 transition-opacity duration-300"></div>
                </div>
                
                {/* Title and stats */}
                <div className="flex-1 min-w-0">
                  <h2 id="modal-title" className="text-3xl font-black text-white mb-3 tracking-tight">
                    {databaseName}
                  </h2>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="
                      flex items-center gap-2 
                      bg-white/20 dark:bg-white/10 
                      backdrop-blur-md px-3 py-1.5 rounded-xl
                      border border-white/20
                      shadow-lg
                    ">
                      <Activity className="h-4 w-4 text-white" strokeWidth={2.5} />
                      <span className="text-sm font-bold text-white">Active Connection</span>
                    </div>

                     <div className="
                      flex items-center gap-2 
                      bg-white/20 dark:bg-white/10 
                      backdrop-blur-md px-3 py-1.5 rounded-xl
                      border border-white/20
                      shadow-lg
                    ">
                      <Table className="h-4 w-4 text-white" strokeWidth={2.5} />
                      <span className="text-sm font-bold text-white">{tableCount} Tables</span>
                    </div>

                    <div className="
                      flex items-center gap-2 
                      bg-white/20 dark:bg-white/10 
                      backdrop-blur-md px-3 py-1.5 rounded-xl
                      border border-white/20
                      shadow-lg
                    ">
                      <Clock className="w-3.5 h-3.5 text-white"  strokeWidth={2.5} />
                      <span className="text-sm font-bold text-white">{getTimeAgo(connectionTime)}</span>
                    </div>
                  </div>
                </div>
                
                {/* Close button */}
                <button
                  onClick={handleCloseModal}
                  className="
                    relative bg-white/20 hover:bg-white/30 backdrop-blur-md
                    p-3 rounded-xl transition-all duration-300
                    hover:rotate-90 hover:scale-110
                    border border-white/20
                    shadow-lg
                    group/close
                  "
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5 text-white" strokeWidth={3} />
                  <div className="absolute inset-0 bg-white/20 rounded-xl opacity-0 group-hover/close:opacity-100 transition-opacity duration-300"></div>
                </button>
              </div>
            </div>

            {/* ===== MODAL CONTENT ===== */}
            <div className="p-8 bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-800/50 dark:to-gray-900/50">
              {/* Section Header with Stats Grid */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-1 tracking-tight">
                      Database Schema
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Explore {tableCount} {tableCount === 1 ? 'table' : 'tables'} and their structure
                    </p>
                  </div>
                </div>
              </div>

              {/* Tables List */}
              {isLoadingTables ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="relative w-16 h-16 mb-4">
                    <div className="absolute inset-0 border-4 border-gray-200 dark:border-gray-700 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">Loading tables...</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Please wait</p>
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
                  <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl">
                    <Database className="w-10 h-10 text-gray-400 dark:text-gray-500" strokeWidth={2} />
                  </div>
                  <h4 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-2">No Tables Found</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">This database is empty. Create your first table to get started.</p>
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
                          bg-white dark:bg-gray-800/50 
                          rounded-2xl 
                          border-2 border-gray-200/60 dark:border-gray-700/50
                          overflow-hidden 
                          hover:border-emerald-300 dark:hover:border-emerald-700
                          hover:shadow-2xl hover:shadow-emerald-500/10
                          transition-all duration-300
                          animate-slideInStagger
                        "
                        style={{ animationDelay: `${index * 30}ms` }}
                      >
                        {/* Table Header */}
                        <button
                          onClick={() => handleTableClick(table)}
                          className="
                            w-full flex items-center gap-4 px-5 py-4
                            hover:bg-gradient-to-r hover:from-emerald-50/50 hover:to-teal-50/50
                            dark:hover:from-emerald-950/20 dark:hover:to-teal-950/20
                            transition-all duration-300
                            focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-inset
                          "
                          aria-expanded={isExpanded}
                        >
                          {/* Icon */}
                          <div className="
                            relative w-12 h-12 
                            bg-gradient-to-br from-emerald-500 to-teal-500 
                            rounded-xl flex items-center justify-center flex-shrink-0
                            shadow-lg shadow-emerald-500/30
                            group-hover/table:scale-110 group-hover/table:rotate-3
                            transition-all duration-300
                          ">
                            <Table className="h-6 w-6 text-white" strokeWidth={2.5} />
                            <div className="absolute inset-0 bg-white/20 rounded-xl opacity-0 group-hover/table:opacity-100 transition-opacity duration-300"></div>
                          </div>
                          
                          {/* Table Info */}
                          <div className="flex-1 min-w-0 text-left">
                            <h4 className="font-mono text-base font-bold text-gray-900 dark:text-gray-50 truncate mb-0.5">
                              {table}
                            </h4>
                            {schema && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                                {schema.columns.length} columns • {schema.columns.filter(c => c.key === 'PRI').length} primary keys
                              </p>
                            )}
                          </div>
                          
                          {/* Status Indicator */}
                          {isLoading ? (
                            <div className="w-6 h-6 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <ChevronDown 
                              className={`
                                h-6 w-6 text-gray-400 dark:text-gray-500
                                transition-all duration-500
                                ${isExpanded ? 'rotate-180 text-emerald-500 scale-110' : 'group-hover/table:translate-y-1'}
                              `}
                              strokeWidth={2.5}
                            />
                          )}
                        </button>

                        {/* Table Schema - Expanded */}
                        {isExpanded && schema && (
                          <div className="
                            px-5 pb-5 pt-2
                            bg-gradient-to-br from-gray-50 to-gray-100/50
                            dark:from-gray-900/50 dark:to-gray-800/50
                            border-t-2 border-gray-200/60 dark:border-gray-700/50
                            animate-expandDown
                          ">
                            {/* Column Headers */}
                            <div className="
                              grid grid-cols-[2fr_1fr_1fr] gap-3
                              px-4 py-3 mb-2
                              bg-white/60 dark:bg-gray-800/60
                              rounded-xl
                              border border-gray-200 dark:border-gray-700
                            ">
                              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                                Column Name
                              </span>
                              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 text-center">
                               DataType
                              </span>
                              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 text-right">
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
                                      bg-white dark:bg-gray-800/50
                                      border-2 border-gray-200/60 dark:border-gray-700/50
                                      hover:border-emerald-300 dark:hover:border-emerald-700
                                      hover:shadow-lg hover:shadow-emerald-500/10
                                      transition-all duration-300
                                      animate-slideInStagger
                                    "
                                    style={{ animationDelay: `${idx * 20}ms` }}
                                  >
                                    {/* Column Name with Icon */}
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className={`
                                        w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
                                        ${typeInfo.bg}
                                        group-hover/column:scale-110 transition-transform duration-300
                                      `}>
                                        <TypeIcon className={`w-4 h-4 ${typeInfo.color}`} strokeWidth={2.5} />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <span className="font-mono text-sm font-bold text-gray-900 dark:text-gray-50 block truncate">
                                          {column.name}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Data Type */}
                                    <div className="flex justify-center">
                                      <span className="
                                        px-3 py-1.5 rounded-lg text-xs font-mono font-bold
                                        bg-gray-100 dark:bg-gray-900/50
                                        text-gray-700 dark:text-gray-300
                                        border border-gray-200 dark:border-gray-700
                                        whitespace-nowrap
                                      ">
                                        {column.type.toLowerCase()}
                                      </span>
                                    </div>

                                    {/* Key Badges */}
                                    <div className="flex items-center gap-1.5 justify-end">
                                      {column.key === 'PRI' && (
                                        <span className="
                                          px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg
                                          bg-gradient-to-r from-amber-100 to-yellow-100
                                          dark:from-amber-900/30 dark:to-yellow-900/30
                                          text-amber-700 dark:text-amber-300
                                          border-2 border-amber-200 dark:border-amber-800/50
                                          shadow-sm shadow-amber-500/20
                                          flex items-center gap-1.5
                                        ">
                                          <Key className="w-3 h-3" strokeWidth={3} />
                                          PK
                                        </span>
                                      )}
                                      {column.key === 'MUL' && (
                                        <span className="
                                          px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg
                                          bg-gradient-to-r from-blue-100 to-indigo-100
                                          dark:from-blue-900/30 dark:to-indigo-900/30
                                          text-blue-700 dark:text-blue-300
                                          border-2 border-blue-200 dark:border-blue-800/50
                                          shadow-sm shadow-blue-500/20
                                        ">
                                          FK
                                        </span>
                                      )}
                                      {column.key === 'UNI' && (
                                        <span className="
                                          px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg
                                          bg-gradient-to-r from-purple-100 to-pink-100
                                          dark:from-purple-900/30 dark:to-pink-900/30
                                          text-purple-700 dark:text-purple-300
                                          border-2 border-purple-200 dark:border-purple-800/50
                                          shadow-sm shadow-purple-500/20
                                        ">
                                          UNQ
                                        </span>
                                      )}
                                      {!column.nullable && !column.key && (
                                        <span className="
                                          px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg
                                          bg-gray-100 dark:bg-gray-800
                                          text-gray-600 dark:text-gray-400
                                          border-2 border-gray-200 dark:border-gray-700
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
              <div className="mt-8 pt-6 border-t-2 border-gray-200 dark:border-gray-700 flex gap-3">
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
                      bg-gradient-to-r from-emerald-600 to-teal-600
                      hover:from-emerald-500 hover:to-teal-500
                      text-white
                      shadow-xl shadow-emerald-500/30
                      hover:shadow-2xl hover:shadow-emerald-500/40
                      hover:scale-105
                      transition-all duration-300
                      focus:outline-none focus:ring-4 focus:ring-emerald-500/40
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
                      bg-gradient-to-r from-red-600 to-rose-600
                      hover:from-red-500 hover:to-rose-500
                      text-white
                      shadow-xl shadow-red-500/30
                      hover:shadow-2xl hover:shadow-red-500/40
                      hover:scale-105
                      transition-all duration-300
                      focus:outline-none focus:ring-4 focus:ring-red-500/40
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
           ADVANCED ANIMATIONS
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

        @keyframes blob {
          0% {
            transform: translate(0px, 0px) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
          100% {
            transform: translate(0px, 0px) scale(1);
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

        .animate-blob {
          animation: blob 7s infinite;
        }

        .animation-delay-2000 {
          animation-delay: 2s;
        }

        .animation-delay-4000 {
          animation-delay: 4s;
        }

        /* ============================================
           PREMIUM SCROLLBAR
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
          background: linear-gradient(to bottom, rgb(16 185 129), rgb(20 184 166));
          border-radius: 100px;
          border: 2px solid transparent;
          background-clip: padding-box;
          box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
        }
        
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to bottom, rgb(5 150 105), rgb(13 148 136));
          background-clip: padding-box;
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.7);
        }

        /* Dark mode scrollbar */
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          box-shadow: 0 0 6px rgba(16, 185, 129, 0.3);
        }

        .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
        }

        /* ============================================
           ACCESSIBILITY ENHANCEMENTS
           ============================================ */
        
        /* Focus visible for keyboard navigation */
        *:focus-visible {
          outline: 3px solid rgb(16 185 129);
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
          .border-emerald-200 {
            border-color: rgb(205, 117, 222);
            border-width: 3px;
          }
          
          .text-gray-600 {
            color: rgb(0 0 0);
          }
        }
      `}</style>
    </>
  );
};

export default ConnectionStatus;
