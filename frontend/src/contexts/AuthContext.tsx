import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  gender: string;
}

interface SignupData {
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
  gender: string;
  email: string;
  password: string;
  confirmPassword: string;
  otp: string;
}

interface AuthContextType {
  user: User | null;
  logout: () => void;
  refreshUser: () => void;
  signup: (data: SignupData) => Promise<boolean>;
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

  // Signup function
  const signup = async (data: SignupData): Promise<boolean> => {
    setIsLoading(true);
    try {
      console.log('[AUTH] Signup attempt for:', data.email);
      
      const response = await axios.post('http://localhost:8000/api/signup', {
        first_name: data.firstName,
        last_name: data.lastName,
        username: data.username,
        phone: data.phone,
        gender: data.gender,
        email: data.email,
        password: data.password,
        otp: data.otp
      });

      if (response.data.success && response.data.user) {
        const newUser: User = {
          id: response.data.user.id,
          firstName: response.data.user.first_name,
          lastName: response.data.user.last_name,
          username: response.data.user.username,
          email: response.data.user.email,
          phone: response.data.user.phone,
          gender: response.data.user.gender
        };

        console.log('[AUTH] Signup successful, saving user:', newUser.username);
        
        // Save to localStorage
        localStorage.setItem('query-genie-user', JSON.stringify(newUser));
        
        // Update state
        setUser(newUser);
        
        // Dispatch custom event for other components
        window.dispatchEvent(new CustomEvent('userLogin'));
        
        // Navigate to dashboard
        navigate('/dashboard');
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[AUTH] Signup failed:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
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
    signup,
    isAuthenticated: !!user,
    isLoading
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};