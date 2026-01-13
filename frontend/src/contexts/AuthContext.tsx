import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  gender: string;
}

interface AuthContextType {
  user: User | null;
  logout: () => void;
  refreshUser: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  // Function to load user from localStorage
  const loadUserFromStorage = () => {
    const savedUser = localStorage.getItem('query-genie-user');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        console.log('[AUTH] Loading user from localStorage:', parsedUser.username);
        setUser(parsedUser);
        return parsedUser;
      } catch (error) {
        console.error('[AUTH] Failed to parse saved user:', error);
        localStorage.removeItem('query-genie-user');
        setUser(null);
        return null;
      }
    } else {
      console.log('[AUTH] No user in localStorage');
      setUser(null);
      return null;
    }
  };

  // Load user on mount
  useEffect(() => {
    console.log('[AUTH] Initializing AuthContext...');
    loadUserFromStorage();
    setIsLoading(false);
  }, []);

  // Listen for storage changes (when user logs in from LoginForm)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'query-genie-user') {
        console.log('[AUTH] Storage changed, reloading user');
        if (e.newValue) {
          try {
            const parsedUser = JSON.parse(e.newValue);
            setUser(parsedUser);
          } catch (error) {
            console.error('[AUTH] Failed to parse user from storage event:', error);
          }
        } else {
          setUser(null);
        }
      }
    };

    // Listen for storage events from other tabs/windows
    window.addEventListener('storage', handleStorageChange);

    // 🔥 Listen for custom event from same tab (LoginForm)
    const handleUserLogin = ((e: CustomEvent) => {
      console.log('[AUTH] userLogin event received, reloading user');
      loadUserFromStorage();
    }) as EventListener;

    window.addEventListener('userLogin', handleUserLogin);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('userLogin', handleUserLogin);
    };
  }, []);

  // Public function to manually refresh user from localStorage
  const refreshUser = () => {
    console.log('[AUTH] Manual refresh requested');
    loadUserFromStorage();
  };

  const logout = () => {
    console.log('[AUTH] Logout called');
    setUser(null);
    localStorage.removeItem('query-genie-user');
    navigate('/auth');
  };

  const value = {
    user,
    logout,
    refreshUser,
    isAuthenticated: !!user,
    isLoading
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};