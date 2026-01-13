import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, LogIn, Mail, ArrowLeft, Clock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

const API_BASE = 'http://localhost:8000/api';

interface LoginFormProps {
  onSwitchToSignup: () => void;
}

const LoginForm = ({ onSwitchToSignup }: LoginFormProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [view, setView] = useState<'login' | 'forgot' | 'otp' | 'reset'>('login');
  const [formData, setFormData] = useState({
    identifier: '',
    password: '',
    email: '',
    otp: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0);
  const [canResend, setCanResend] = useState(false);

  // Timer for OTP expiration
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (otpTimer > 0) {
      interval = setInterval(() => {
        setOtpTimer(prev => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [otpTimer]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (view === 'login') {
      if (!formData.identifier.trim()) newErrors.identifier = 'Username or email is required';
      if (!formData.password) newErrors.password = 'Password is required';
      else if (formData.password.length < 8) newErrors.password = 'Password must be at least 8 characters';
    }
    
    if (view === 'forgot') {
      if (!formData.email.trim()) newErrors.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Invalid email';
    }

    if (view === 'otp') {
      if (!formData.otp.trim()) newErrors.otp = 'OTP is required';
      else if (!/^\d{6}$/.test(formData.otp)) newErrors.otp = 'OTP must be 6 digits';
    }

    if (view === 'reset') {
      if (!formData.newPassword) newErrors.newPassword = 'New password is required';
      else if (formData.newPassword.length < 8) newErrors.newPassword = 'Password must be at least 8 characters';
      if (!formData.confirmPassword) newErrors.confirmPassword = 'Confirm your password';
      else if (formData.newPassword !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!validateForm()) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: formData.identifier,
          password: formData.password
        })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        console.log('✅ [LOGIN] Login successful');
        
        // Format user data to match AuthContext expectations
        const userData = {
          id: data.user.id.toString(),
          firstName: data.user.firstName,
          lastName: data.user.lastName,
          username: data.user.username,
          email: data.user.email,
          phone: data.user.phone || '',
          gender: data.user.gender
        };
        
        // Store with the correct key that AuthContext expects
        localStorage.setItem('query-genie-user', JSON.stringify(userData));
        console.log('✅ [LOGIN] User saved to localStorage:', userData.username);
        
        // 🔥 CRITICAL FIX: Dispatch custom event to notify AuthContext
        window.dispatchEvent(new CustomEvent('userLogin', { detail: userData }));
        console.log('✅ [LOGIN] userLogin event dispatched');
        
        toast({
          title: "Welcome back!",
          description: "Login successful. Redirecting...",
        });
        
        // Navigate to dashboard
        setTimeout(() => {
          console.log('🔄 [LOGIN] Navigating to /dashboard');
          navigate('/dashboard', { replace: true });
        }, 500);
      } else {
        toast({
          variant: "destructive",
          title: "Login failed",
          description: data.detail || 'Incorrect username/email or password',
        });
      }
    } catch (err) {
      console.error('❌ [LOGIN] Login error:', err);
      toast({
        variant: "destructive",
        title: "Connection error",
        description: "Please check your backend is running.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOTP = async () => {
    if (!validateForm()) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        toast({
          title: "OTP Sent!",
          description: data.message,
        });
        setView('otp');
        setOtpTimer(600); // 10 minutes
        setCanResend(false);
      } else {
        toast({
          variant: "destructive",
          title: "Failed to send OTP",
          description: data.detail || 'Please try again.',
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Connection error",
        description: "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (!canResend) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/resend-reset-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        toast({
          title: "OTP Resent!",
          description: data.message,
        });
        setOtpTimer(600);
        setCanResend(false);
        setFormData(prev => ({ ...prev, otp: '' }));
      } else {
        toast({
          variant: "destructive",
          title: "Failed to resend",
          description: data.message || 'Please try again.',
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Connection error",
        description: "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!validateForm()) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/verify-reset-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          otp: formData.otp
        })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        toast({
          title: "OTP Verified!",
          description: "Now create your new password.",
        });
        setView('reset');
      } else {
        toast({
          variant: "destructive",
          title: "Invalid OTP",
          description: data.detail || 'Please check and try again.',
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Connection error",
        description: "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!validateForm()) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          otp: formData.otp,
          new_password: formData.newPassword
        })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        toast({
          title: "Password reset successful!",
          description: "You can now login with your new password.",
        });
        setTimeout(() => handleBackToLogin(), 2000);
      } else {
        toast({
          variant: "destructive",
          title: "Reset failed",
          description: data.detail || 'Please try again.',
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Connection error",
        description: "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setView('login');
    setErrors({});
    setOtpTimer(0);
    setCanResend(false);
    setFormData({
      identifier: '',
      password: '',
      email: '',
      otp: '',
      newPassword: '',
      confirmPassword: ''
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // LOGIN VIEW
  if (view === 'login') {
    return (
      <form onSubmit={handleLogin} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="identifier">Username or Email</Label>
          <Input
            id="identifier"
            type="text"
            value={formData.identifier}
            onChange={(e) => handleInputChange('identifier', e.target.value)}
            placeholder="Enter username or email"
            className={errors.identifier ? 'border-destructive' : ''}
            disabled={isLoading}
          />
          {errors.identifier && <p className="text-xs text-destructive">{errors.identifier}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <button 
              type="button"
              onClick={() => setView('forgot')}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              disabled={isLoading}
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              placeholder="Enter password"
              className={errors.password ? 'border-destructive' : ''}
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={isLoading}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
        </div>

        <Button 
          type="submit"
          className="w-full gradient-brand"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Signing In...
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4 mr-2" />
              Sign In
            </>
          )}
        </Button>

        <p className="text-center text-caption">
          Don't have an account?{' '}
          <button 
            type="button"
            onClick={onSwitchToSignup}
            className="text-brand-600 hover:text-brand-700 font-medium"
            disabled={isLoading}
          >
            Sign Up
          </button>
        </p>
      </form>
    );
  }

  // FORGOT PASSWORD VIEW
  if (view === 'forgot') {
    return (
      <div className="space-y-5">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-100 rounded-full mb-3">
            <Mail className="w-6 h-6 text-brand-600" />
          </div>
          <h3 className="text-xl font-semibold mb-1">Forgot Password?</h3>
          <p className="text-sm text-muted-foreground">We'll send you a reset code</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email Address</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
            placeholder="Enter your email"
            className={errors.email ? 'border-destructive' : ''}
            disabled={isLoading}
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
        </div>

        <Button 
          onClick={handleSendOTP}
          className="w-full gradient-brand"
          disabled={isLoading}
        >
          {isLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : 'Send OTP'}
        </Button>

        <button 
          onClick={handleBackToLogin} 
          className="w-full flex items-center justify-center text-muted-foreground hover:text-foreground text-sm"
          disabled={isLoading}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />Back to Sign In
        </button>
      </div>
    );
  }

  // OTP VERIFICATION VIEW
  if (view === 'otp') {
    return (
      <div className="space-y-5">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-100 rounded-full mb-3">
            <Mail className="w-6 h-6 text-brand-600" />
          </div>
          <h3 className="text-xl font-semibold mb-1">Verify OTP</h3>
          <p className="text-sm text-muted-foreground">Code sent to <span className="font-medium text-brand-600">{formData.email}</span></p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="otp">Enter 6-Digit OTP</Label>
          <Input
            id="otp"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={formData.otp}
            onChange={(e) => handleInputChange('otp', e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && handleVerifyOTP()}
            placeholder="000000"
            className={`text-center text-2xl tracking-widest font-semibold ${errors.otp ? 'border-destructive' : ''}`}
            disabled={isLoading}
            autoFocus
          />
          {errors.otp && <p className="text-xs text-destructive">{errors.otp}</p>}
        </div>

        {otpTimer > 0 && (
          <div className="flex items-center justify-center text-sm bg-brand-50 py-3 px-4 rounded-lg">
            <Clock className="w-4 h-4 mr-2 text-brand-600" />
            <span className="text-muted-foreground">Resend in <span className="font-bold text-brand-600">{formatTime(otpTimer)}</span></span>
          </div>
        )}

        {canResend && (
          <div className="text-center bg-green-50 py-3 px-4 rounded-lg">
            <button 
              onClick={handleResendOTP} 
              className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 font-semibold text-sm"
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Resend OTP
            </button>
          </div>
        )}

        <Button 
          onClick={handleVerifyOTP}
          className="w-full gradient-brand"
          disabled={isLoading || formData.otp.length !== 6}
        >
          {isLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</> : 'Verify OTP'}
        </Button>

        <button 
          onClick={handleBackToLogin} 
          className="w-full flex items-center justify-center text-muted-foreground hover:text-foreground text-sm"
          disabled={isLoading}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />Back to Sign In
        </button>
      </div>
    );
  }

  // RESET PASSWORD VIEW
  if (view === 'reset') {
    return (
      <div className="space-y-5">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-100 rounded-full mb-3">
            <LogIn className="w-6 h-6 text-brand-600" />
          </div>
          <h3 className="text-xl font-semibold mb-1">Reset Password</h3>
          <p className="text-sm text-muted-foreground">Create a new password</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="newPassword">New Password</Label>
          <div className="relative">
            <Input
              id="newPassword"
              type={showNewPassword ? 'text' : 'password'}
              value={formData.newPassword}
              onChange={(e) => handleInputChange('newPassword', e.target.value)}
              placeholder="Enter new password"
              className={errors.newPassword ? 'border-destructive' : ''}
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={isLoading}
            >
              {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
              placeholder="Confirm new password"
              className={errors.confirmPassword ? 'border-destructive' : ''}
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={isLoading}
            >
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword}</p>}
        </div>

        <Button 
          onClick={handleResetPassword}
          className="w-full gradient-brand"
          disabled={isLoading}
        >
          {isLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Resetting...</> : 'Reset Password'}
        </Button>
      </div>
    );
  }

  return null;
};

export default LoginForm;