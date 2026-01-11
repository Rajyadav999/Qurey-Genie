import React from 'react';
import { Database, CheckCircle2 } from 'lucide-react';

interface ConnectionStatusProps {
  isConnected: boolean;
  databaseName?: string;
  databaseType?: string;
  host?: string;
  user?: string;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ 
  isConnected, 
  databaseName,
  databaseType = "MySQL",
  host,
  user
}) => {
  // Only show when connected
  if (!isConnected) return null;

  const displayName = databaseName || databaseType;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
      {/* Main Status */}
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="text-sm font-medium text-green-900 dark:text-green-100">
          Connected to {displayName}
        </span>
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 ml-auto" />
      </div>
      
      {/* Connection Details (Optional) */}
      {(host || user) && (
        <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300 pl-4 font-mono">
          <Database className="h-3 w-3" />
          {user && host ? `${user}@${host}` : user || host}
        </div>
      )}
    </div>
  );
};

export default ConnectionStatus;