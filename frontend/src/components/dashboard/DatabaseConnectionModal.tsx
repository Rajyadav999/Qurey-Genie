import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Database, Loader2, CheckCircle, AlertCircle, Lightbulb, XCircle, WifiOff, Lock, Server, ChevronRight, ChevronLeft, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const API_BASE = "http://localhost:8000";

interface DatabaseConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (data: any) => void;
}

interface DBCredentials {
  host: string;
  port: string;
  user: string;
  password: string;
}

interface ConnectionError {
  success?: boolean;
  error: string;
  message: string;
  suggestion?: string;
  code: string;
}

type ConnectionStep = 'credentials' | 'database-selection';

export const DatabaseConnectionModal = ({ isOpen, onClose, onConnect }: DatabaseConnectionModalProps) => {
  // Step management
  const [currentStep, setCurrentStep] = useState<ConnectionStep>('credentials');
  
  // Credentials state
  const [credentials, setCredentials] = useState<DBCredentials>({
    host: '127.0.0.1',
    port: '3306',
    user: 'root',
    password: '',
  });

  // Database selection state
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('');

  // Create database state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newDatabaseName, setNewDatabaseName] = useState('');
  const [isCreatingDatabase, setIsCreatingDatabase] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // UI state
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<ConnectionError | null>(null);
  
  const { toast } = useToast();

  const handleCredentialsChange = (field: keyof DBCredentials, value: string) => {
    setCredentials(prev => ({ ...prev, [field]: value }));
    if (connectionError) {
      setConnectionError(null);
    }
  };

  const handleListDatabases = async () => {
    // Validate credentials
    if (!credentials.host.trim()) {
      toast({
        variant: "destructive",
        title: "Host Required",
        description: "Please enter the database host",
      });
      return;
    }

    if (!credentials.user.trim()) {
      toast({
        variant: "destructive",
        title: "Username Required",
        description: "Please enter your database username",
      });
      return;
    }

    const portNum = parseInt(credentials.port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      toast({
        variant: "destructive",
        title: "Invalid Port",
        description: "Port must be a number between 1 and 65535",
      });
      return;
    }

    setConnectionError(null);
    setIsLoadingDatabases(true);

    try {
      const response = await fetch(`${API_BASE}/api/list-databases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: credentials.host.trim(),
          port: portNum,
          user: credentials.user.trim(),
          password: credentials.password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.detail && typeof data.detail === 'object') {
          setConnectionError(data.detail);
          
          if (data.detail.code === 'AUTH_FAILED') {
            toast({
              variant: "destructive",
              title: "Authentication Failed",
              description: "Please check your username and password",
            });
          } else if (data.detail.code === 'CONNECTION_REFUSED') {
            toast({
              variant: "destructive",
              title: "Connection Refused",
              description: "Cannot connect to MySQL server",
            });
          }
        } else {
          setConnectionError({
            error: "Connection Error",
            message: data.message || 'Failed to connect to MySQL server.',
            code: "UNKNOWN_ERROR"
          });
        }
        return;
      }

      if (data.success) {
        setAvailableDatabases(data.databases || []);
        setCurrentStep('database-selection');
        toast({
          title: "✅ Server Connected",
          description: `Found ${data.databases?.length || 0} database(s)`,
        });
      } else {
        setConnectionError({
          error: "No Databases Found",
          message: "No user databases found on this server.",
          suggestion: "CREATE DATABASE my_database;",
          code: "NO_DATABASES"
        });
      }
    } catch (error: any) {
      console.error('Error listing databases:', error);
      setConnectionError({
        error: "Network Error",
        message: "Unable to reach the backend server. Please ensure the server is running on port 8000.",
        suggestion: "Start the backend server using: python main.py",
        code: "NETWORK_ERROR"
      });
      
      toast({
        variant: "destructive",
        title: "Network Error",
        description: "Cannot connect to backend server",
      });
    } finally {
      setIsLoadingDatabases(false);
    }
  };

  const handleCreateDatabase = async () => {
    // Validate database name
    const dbName = newDatabaseName.trim();
    
    if (!dbName) {
      setCreateError("Database name is required");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
      setCreateError("Database name can only contain letters, numbers, and underscores");
      return;
    }

    if (dbName.length > 64) {
      setCreateError("Database name must be 64 characters or less");
      return;
    }

    if (availableDatabases.includes(dbName)) {
      setCreateError(`Database '${dbName}' already exists`);
      return;
    }

    setCreateError(null);
    setIsCreatingDatabase(true);

    const portNum = parseInt(credentials.port, 10);

    try {
      const response = await fetch(`${API_BASE}/api/create-database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: credentials.host.trim(),
          port: portNum,
          user: credentials.user.trim(),
          password: credentials.password,
          database_name: dbName
        })
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.detail && typeof data.detail === 'object') {
          setCreateError(data.detail.message || 'Failed to create database');
          
          if (data.detail.code === 'PERMISSION_DENIED') {
            toast({
              variant: "destructive",
              title: "Permission Denied",
              description: "Your MySQL user doesn't have permission to create databases",
            });
          } else if (data.detail.code === 'DATABASE_EXISTS') {
            toast({
              variant: "destructive",
              title: "Database Already Exists",
              description: `Database '${dbName}' already exists`,
            });
          }
        } else {
          setCreateError(data.message || 'Failed to create database');
        }
        return;
      }

      if (data.success) {
        toast({
          title: "✅ Database Created!",
          description: `Database '${dbName}' created successfully`,
          duration: 3000,
        });

        // Refresh database list and select the new database
        setAvailableDatabases(prev => [...prev, dbName].sort());
        setSelectedDatabase(dbName);
        
        // Close create dialog and reset
        setShowCreateDialog(false);
        setNewDatabaseName('');
        setCreateError(null);
      }
    } catch (error: any) {
      console.error('Error creating database:', error);
      setCreateError("Network error: Unable to create database");
      
      toast({
        variant: "destructive",
        title: "Network Error",
        description: "Cannot connect to backend server",
      });
    } finally {
      setIsCreatingDatabase(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedDatabase) {
      toast({
        variant: "destructive",
        title: "Database Required",
        description: "Please select a database to connect to",
      });
      return;
    }

    setConnectionError(null);
    setIsConnecting(true);

    const portNum = parseInt(credentials.port, 10);

    try {
      const response = await fetch(`${API_BASE}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: credentials.host.trim(),
          port: portNum,
          user: credentials.user.trim(),
          password: credentials.password,
          database: selectedDatabase
        })
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.detail && typeof data.detail === 'object') {
          setConnectionError(data.detail);
        } else {
          setConnectionError({
            error: "Connection Error",
            message: data.message || 'Failed to connect to database',
            code: "UNKNOWN_ERROR"
          });
        }
        return;
      }

      if (data.success) {
        toast({
          title: "✅ Connection Successful!",
          description: `Connected to ${selectedDatabase} database successfully.`,
          duration: 5000,
        });
        
        onConnect({
          type: 'mysql',
          host: credentials.host,
          port: credentials.port,
          user: credentials.user,
          password: credentials.password,
          database: selectedDatabase
        });
        
        handleClose();
      }
    } catch (error: any) {
      console.error('Error connecting to database:', error);
      setConnectionError({
        error: "Network Error",
        message: "Unable to reach the backend server.",
        code: "NETWORK_ERROR"
      });
      
      toast({
        variant: "destructive",
        title: "Network Error",
        description: "Cannot connect to backend server",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleBack = () => {
    setCurrentStep('credentials');
    setSelectedDatabase('');
    setConnectionError(null);
  };

  const handleClose = () => {
    setCurrentStep('credentials');
    setCredentials({
      host: '127.0.0.1',
      port: '3306',
      user: 'root',
      password: ''
    });
    setAvailableDatabases([]);
    setSelectedDatabase('');
    setConnectionError(null);
    setShowCreateDialog(false);
    setNewDatabaseName('');
    setCreateError(null);
    onClose();
  };

  const openCreateDialog = () => {
    setShowCreateDialog(true);
    setNewDatabaseName('');
    setCreateError(null);
  };

  const closeCreateDialog = () => {
    setShowCreateDialog(false);
    setNewDatabaseName('');
    setCreateError(null);
  };

  // Get appropriate icon based on error code
  const getErrorIcon = () => {
    if (!connectionError) return null;
    
    switch (connectionError.code) {
      case 'DATABASE_NOT_FOUND':
      case 'NO_DATABASES':
        return <Database className="h-5 w-5" />;
      case 'AUTH_FAILED':
        return <Lock className="h-5 w-5" />;
      case 'CONNECTION_REFUSED':
        return <Server className="h-5 w-5" />;
      case 'CONNECTION_TIMEOUT':
        return <WifiOff className="h-5 w-5" />;
      case 'HOST_NOT_FOUND':
        return <XCircle className="h-5 w-5" />;
      case 'NETWORK_ERROR':
        return <WifiOff className="h-5 w-5" />;
      default:
        return <AlertCircle className="h-5 w-5" />;
    }
  };

  const getErrorVariant = (): "default" | "destructive" => {
    if (!connectionError) return "default";
    
    switch (connectionError.code) {
      case 'DATABASE_NOT_FOUND':
      case 'HOST_NOT_FOUND':
      case 'NO_DATABASES':
        return "default";
      default:
        return "destructive";
    }
  };

  const getErrorTitle = () => {
    if (!connectionError) return "";
    
    const emojiMap: Record<string, string> = {
      'DATABASE_NOT_FOUND': '🗄️',
      'NO_DATABASES': '🗄️',
      'AUTH_FAILED': '🔐',
      'CONNECTION_REFUSED': '🚫',
      'CONNECTION_TIMEOUT': '⏱️',
      'HOST_NOT_FOUND': '🌐',
      'NETWORK_ERROR': '📡',
    };
    
    const emoji = emojiMap[connectionError.code] || '⚠️';
    return `${emoji} ${connectionError.error}`;
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoadingDatabases && !isConnecting) {
      if (currentStep === 'credentials') {
        handleListDatabases();
      } else if (selectedDatabase) {
        handleConnect();
      }
    }
  };

  const handleCreateKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreatingDatabase) {
      handleCreateDatabase();
    }
  };

  const isCredentialsValid = credentials.host && credentials.port && credentials.user;
  
  return (
    <>
      {/* Main Connection Dialog */}
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              {currentStep === 'credentials' ? 'Connect to MySQL Server' : 'Select Database'}
            </DialogTitle>
            <DialogDescription>
              {currentStep === 'credentials' 
                ? 'Enter your MySQL server credentials to view available databases'
                : 'Choose a database to connect to and start querying'
              }
            </DialogDescription>
          </DialogHeader>

          {/* Error Alert */}
          {connectionError && (
            <Alert variant={getErrorVariant()} className="animate-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                {getErrorIcon()}
                <div className="flex-1 space-y-1">
                  <AlertTitle className="text-base font-semibold">
                    {getErrorTitle()}
                  </AlertTitle>
                  <AlertDescription className="text-sm leading-relaxed">
                    {connectionError.message}
                  </AlertDescription>
                  
                  {connectionError.suggestion && (
                    <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800 animate-in fade-in-50">
                      <div className="flex items-start gap-2">
                        <Lightbulb className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 space-y-2">
                          <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">
                            💡 Solution:
                          </p>
                          <code className="text-xs text-blue-800 dark:text-blue-200 block bg-blue-100 dark:bg-blue-900 p-2 rounded border border-blue-200 dark:border-blue-700 font-mono whitespace-pre-wrap break-all">
                            {connectionError.suggestion}
                          </code>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Alert>
          )}

          <div className="space-y-4 py-2" onKeyPress={handleKeyPress}>
            {currentStep === 'credentials' ? (
              <>
                {/* Step 1: Credentials Form */}
                <div className="space-y-2">
                  <Label htmlFor="host" className="flex items-center gap-1">
                    Host <span className="text-red-500">*</span>
                  </Label>
                  <Input 
                    id="host" 
                    value={credentials.host} 
                    onChange={(e) => handleCredentialsChange('host', e.target.value)}
                    placeholder="127.0.0.1 or localhost"
                    disabled={isLoadingDatabases}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Server address where MySQL is running
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="port" className="flex items-center gap-1">
                    Port <span className="text-red-500">*</span>
                  </Label>
                  <Input 
                    id="port" 
                    value={credentials.port} 
                    onChange={(e) => handleCredentialsChange('port', e.target.value)}
                    placeholder="3306"
                    disabled={isLoadingDatabases}
                    className="font-mono"
                    type="number"
                    min="1"
                    max="65535"
                  />
                  <p className="text-xs text-muted-foreground">
                    MySQL server port (default: 3306)
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="user" className="flex items-center gap-1">
                    Username <span className="text-red-500">*</span>
                  </Label>
                  <Input 
                    id="user" 
                    value={credentials.user} 
                    onChange={(e) => handleCredentialsChange('user', e.target.value)}
                    placeholder="root"
                    disabled={isLoadingDatabases}
                    className="font-mono"
                    autoComplete="username"
                  />
                  <p className="text-xs text-muted-foreground">
                    Database username for authentication
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input 
                    id="password" 
                    type="password" 
                    value={credentials.password} 
                    onChange={(e) => handleCredentialsChange('password', e.target.value)}
                    placeholder="Enter password (if any)"
                    disabled={isLoadingDatabases}
                    autoComplete="current-password"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank if no password is set
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button 
                    variant="outline" 
                    onClick={handleClose} 
                    disabled={isLoadingDatabases}
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleListDatabases} 
                    disabled={!isCredentialsValid || isLoadingDatabases}
                    className="min-w-[140px]"
                  >
                    {isLoadingDatabases ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        List Databases
                        <ChevronRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Step 2: Database Selection */}
                <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span className="font-medium text-green-900 dark:text-green-100">
                      Server Connected Successfully
                    </span>
                  </div>
                  <div className="text-xs text-green-700 dark:text-green-300 pl-6 font-mono">
                    {credentials.user}@{credentials.host}:{credentials.port}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="database" className="flex items-center gap-1">
                    Select Database <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={selectedDatabase}
                    onValueChange={setSelectedDatabase}
                    disabled={isConnecting}
                  >
                    <SelectTrigger id="database" className="w-full font-mono">
                      <SelectValue placeholder="Choose a database..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableDatabases.map((db) => (
                        <SelectItem key={db} value={db} className="font-mono">
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4 text-muted-foreground" />
                            {db}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {availableDatabases.length} database{availableDatabases.length !== 1 ? 's' : ''} available
                  </p>
                </div>

                {/* Create New Database Button */}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={openCreateDialog}
                  disabled={isConnecting}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create New Database
                </Button>

                {/* Action Buttons */}
                <div className="flex justify-between gap-2 pt-4 border-t">
                  <Button 
                    variant="outline" 
                    onClick={handleBack} 
                    disabled={isConnecting}
                  >
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                  <Button 
                    onClick={handleConnect} 
                    disabled={!selectedDatabase || isConnecting}
                    className="min-w-[120px]"
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Connect
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Database Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={closeCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Create New Database
            </DialogTitle>
            <DialogDescription>
              Enter a name for your new MySQL database
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2" onKeyPress={handleCreateKeyPress}>
            {/* Error Alert */}
            {createError && (
              <Alert variant="destructive" className="animate-in slide-in-from-top-2">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="newDbName" className="flex items-center gap-1">
                Database Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="newDbName"
                value={newDatabaseName}
                onChange={(e) => {
                  setNewDatabaseName(e.target.value);
                  setCreateError(null);
                }}
                placeholder="my_database"
                disabled={isCreatingDatabase}
                className="font-mono"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Only letters, numbers, and underscores allowed (max 64 characters)
              </p>
            </div>

            {/* Info Box */}
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3">
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-blue-900 dark:text-blue-100">
                  <p className="font-semibold mb-1">💡 Naming Tips:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-200">
                    <li>Use lowercase for consistency</li>
                    <li>Separate words with underscores (e.g., my_app_db)</li>
                    <li>Keep it descriptive but concise</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={closeCreateDialog}
                disabled={isCreatingDatabase}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateDatabase}
                disabled={!newDatabaseName.trim() || isCreatingDatabase}
                className="min-w-[120px]"
              >
                {isCreatingDatabase ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Create
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};