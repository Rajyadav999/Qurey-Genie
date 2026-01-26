import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, LogIn, Mail, ArrowLeft, Clock, RefreshCw, Shield, Lock } from 'lucide-react';
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
        
        const userData = {
          id: data.user.id.toString(),
          firstName: data.user.firstName,
          lastName: data.user.lastName,
          username: data.user.username,
          email: data.user.email,
          phone: data.user.phone || '',
          gender: data.user.gender
        };
        
        localStorage.setItem('query-genie-user', JSON.stringify(userData));
        console.log('✅ [LOGIN] User saved to localStorage:', userData.username);
        
        window.dispatchEvent(new CustomEvent('userLogin', { detail: userData }));
        console.log('✅ [LOGIN] userLogin event dispatched');
        
        toast({
          title: "Welcome back!",
          description: "Login successful. Redirecting...",
        });
        
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
        setOtpTimer(600);
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
      <div className="w-full max-w-md mx-auto">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-3">
            Welcome back
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 font-normal">
            Sign in to continue to your account
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2.5">
            <Label 
              htmlFor="identifier" 
              className="text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              Username or Email
            </Label>
            <Input
              id="identifier"
              type="text"
              value={formData.identifier}
              onChange={(e) => handleInputChange('identifier', e.target.value)}
              placeholder="john@example.com"
              className={`h-12 px-4 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200 
                focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                ${errors.identifier ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                disabled:opacity-50 disabled:cursor-not-allowed
                placeholder:text-slate-400 dark:placeholder:text-slate-500`}
              disabled={isLoading}
            />
            {errors.identifier && (
              <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                <span className="w-1 h-1 bg-rose-600 dark:bg-rose-400 rounded-full"></span>
                {errors.identifier}
              </p>
            )}
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label 
                htmlFor="password"
                className="text-sm font-semibold text-slate-700 dark:text-slate-300"
              >
                Password
              </Label>
              <button 
                type="button"
                onClick={() => setView('forgot')}
                className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium transition-colors duration-200"
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
                placeholder="Enter your password"
                className={`h-12 px-4 pr-12 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                  focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                  ${errors.password ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed
                  placeholder:text-slate-400 dark:placeholder:text-slate-500`}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                disabled={isLoading}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={20} strokeWidth={2} /> : <Eye size={20} strokeWidth={2} />}
              </button>
            </div>
            {errors.password && (
              <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                <span className="w-1 h-1 bg-rose-600 dark:bg-rose-400 rounded-full"></span>
                {errors.password}
              </p>
            )}
          </div>

          <Button 
            type="submit"
            className="w-full h-12 text-base font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-xl shadow-lg shadow-slate-900/10 dark:shadow-slate-100/10 transition-all duration-200 active:scale-[0.98]"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" strokeWidth={2.5} />
                <span>Signing In...</span>
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5 mr-2" strokeWidth={2.5} />
                <span>Sign In</span>
              </>
            )}
          </Button>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-medium">
                New to our platform?
              </span>
            </div>
          </div>

          <button 
            type="button"
            onClick={onSwitchToSignup}
            className="w-full h-12 text-base font-semibold border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-400 dark:hover:border-slate-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
            disabled={isLoading}
          >
            Create an Account
          </button>
        </form>
      </div>
    );
  }

  // FORGOT PASSWORD VIEW
  if (view === 'forgot') {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 rounded-2xl mb-5 shadow-sm">
            <Mail className="w-8 h-8 text-slate-700 dark:text-slate-300" strokeWidth={2} />
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-3">
            Forgot Password?
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-normal max-w-sm mx-auto">
            No worries! Enter your email and we'll send you a reset code
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-2.5">
            <Label 
              htmlFor="email"
              className="text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              Email Address
            </Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
              placeholder="john@example.com"
              className={`h-12 px-4 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                ${errors.email ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                disabled:opacity-50 disabled:cursor-not-allowed
                placeholder:text-slate-400 dark:placeholder:text-slate-500`}
              disabled={isLoading}
              autoFocus
            />
            {errors.email && (
              <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                <span className="w-1 h-1 bg-rose-600 dark:bg-rose-400 rounded-full"></span>
                {errors.email}
              </p>
            )}
          </div>

          <Button 
            onClick={handleSendOTP}
            className="w-full h-12 text-base font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-xl shadow-lg shadow-slate-900/10 dark:shadow-slate-100/10 transition-all duration-200 active:scale-[0.98]"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" strokeWidth={2.5} />
                <span>Sending Code...</span>
              </>
            ) : (
              <>
                <Mail className="w-5 h-5 mr-2" strokeWidth={2.5} />
                <span>Send Reset Code</span>
              </>
            )}
          </Button>

          <button 
            onClick={handleBackToLogin} 
            className="w-full flex items-center justify-center gap-2 h-12 text-base font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors duration-200"
            disabled={isLoading}
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
            <span>Back to Sign In</span>
          </button>
        </div>
      </div>
    );
  }

  // OTP VERIFICATION VIEW
  if (view === 'otp') {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/30 dark:to-emerald-950/30 rounded-2xl mb-5 shadow-sm">
            <Shield className="w-8 h-8 text-emerald-700 dark:text-emerald-400" strokeWidth={2} />
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-3">
            Verify Your Email
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-normal max-w-sm mx-auto">
            We sent a 6-digit code to{' '}
            <span className="font-semibold text-slate-900 dark:text-white block mt-1">
              {formData.email}
            </span>
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-2.5">
            <Label 
              htmlFor="otp"
              className="text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              Verification Code
            </Label>
            <Input
              id="otp"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={formData.otp}
              onChange={(e) => handleInputChange('otp', e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyOTP()}
              placeholder="000000"
              className={`h-16 px-4 text-center text-3xl tracking-[0.5em] font-bold border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                ${errors.otp ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                disabled:opacity-50 disabled:cursor-not-allowed
                placeholder:text-slate-300 dark:placeholder:text-slate-600 placeholder:tracking-[0.5em]`}
              disabled={isLoading}
              autoFocus
            />
            {errors.otp && (
              <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                <span className="w-1 h-1 bg-rose-600 dark:bg-rose-400 rounded-full"></span>
                {errors.otp}
              </p>
            )}
          </div>

          {otpTimer > 0 && (
            <div className="flex items-center justify-center gap-3 bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-slate-800/50 dark:to-slate-900/30 py-4 px-5 rounded-xl border border-slate-200 dark:border-slate-700">
              <Clock className="w-5 h-5 text-slate-600 dark:text-slate-400" strokeWidth={2} />
              <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">
                Code expires in{' '}
                <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                  {formatTime(otpTimer)}
                </span>
              </span>
            </div>
          )}

          {canResend && (
            <div className="bg-gradient-to-r from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-950/20 py-4 px-5 rounded-xl border border-emerald-200 dark:border-emerald-800">
              <button 
                onClick={handleResendOTP} 
                className="w-full inline-flex items-center justify-center gap-2.5 text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 font-semibold text-base transition-colors duration-200"
                disabled={isLoading}
              >
                <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} strokeWidth={2} />
                <span>Resend Verification Code</span>
              </button>
            </div>
          )}

          <Button 
            onClick={handleVerifyOTP}
            className="w-full h-12 text-base font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-xl shadow-lg shadow-slate-900/10 dark:shadow-slate-100/10 transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
            disabled={isLoading || formData.otp.length !== 6}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" strokeWidth={2.5} />
                <span>Verifying...</span>
              </>
            ) : (
              <>
                <Shield className="w-5 h-5 mr-2" strokeWidth={2.5} />
                <span>Verify Code</span>
              </>
            )}
          </Button>

          <button 
            onClick={handleBackToLogin} 
            className="w-full flex items-center justify-center gap-2 h-12 text-base font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors duration-200"
            disabled={isLoading}
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
            <span>Back to Sign In</span>
          </button>
        </div>
      </div>
    );
  }

  // RESET PASSWORD VIEW
  if (view === 'reset') {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-100 to-blue-50 dark:from-blue-900/30 dark:to-blue-950/30 rounded-2xl mb-5 shadow-sm">
            <Lock className="w-8 h-8 text-blue-700 dark:text-blue-400" strokeWidth={2} />
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-3">
            Create New Password
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-normal max-w-sm mx-auto">
            Choose a strong password to secure your account
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-2.5">
            <Label 
              htmlFor="newPassword"
              className="text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              New Password
            </Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={formData.newPassword}
                onChange={(e) => handleInputChange('newPassword', e.target.value)}
                placeholder="Enter new password"
                className={`h-12 px-4 pr-12 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                  focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                  ${errors.newPassword ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed
                  placeholder:text-slate-400 dark:placeholder:text-slate-500`}
                disabled={isLoading}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                disabled={isLoading}
                tabIndex={-1}
              >
                {showNewPassword ? <EyeOff size={20} strokeWidth={2} /> : <Eye size={20} strokeWidth={2} />}
              </button>
            </div>
            {errors.newPassword && (
              <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                <span className="w-1 h-1 bg-rose-600 dark:bg-rose-400 rounded-full"></span>
                {errors.newPassword}
              </p>
            )}
          </div>

          <div className="space-y-2.5">
            <Label 
              htmlFor="confirmPassword"
              className="text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              Confirm Password
            </Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                placeholder="Confirm new password"
                className={`h-12 px-4 pr-12 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                  focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                  ${errors.confirmPassword ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed
                  placeholder:text-slate-400 dark:placeholder:text-slate-500`}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                disabled={isLoading}
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff size={20} strokeWidth={2} /> : <Eye size={20} strokeWidth={2} />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                <span className="w-1 h-1 bg-rose-600 dark:bg-rose-400 rounded-full"></span>
                {errors.confirmPassword}
              </p>
            )}
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
            <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">
              Password must be at least 8 characters long
            </p>
          </div>

          <Button 
            onClick={handleResetPassword}
            className="w-full h-12 text-base font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-xl shadow-lg shadow-slate-900/10 dark:shadow-slate-100/10 transition-all duration-200 active:scale-[0.98]"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" strokeWidth={2.5} />
                <span>Resetting Password...</span>
              </>
            ) : (
              <>
                <Lock className="w-5 h-5 mr-2" strokeWidth={2.5} />
                <span>Reset Password</span>
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return null;
};

export default LoginForm;
