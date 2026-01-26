import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, EyeOff, Loader2, Mail, UserPlus, Check, Shield, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import axios from 'axios';

interface SignupFormProps {
  onSwitchToLogin: () => void;
}

const SignupForm = ({ onSwitchToLogin }: SignupFormProps) => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    username: '',  
    phone: '',  
    gender: '',
    email: '',
    password: '',
    confirmPassword: '',
    otp: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [otpSent, setOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  const { signup, isLoading } = useAuth();
  const { toast } = useToast();

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    } else if (!/^[A-Za-z]+$/.test(formData.firstName)) {
      newErrors.firstName = 'Must contain only letters';
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    } else if (!/^[A-Za-z]+$/.test(formData.lastName)) {
      newErrors.lastName = 'Must contain only letters';
    }

    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    } else if (!/^[A-Za-z0-9_]+$/.test(formData.username)) {
      newErrors.username = 'Only letters, numbers, and underscores';
    } else if (formData.username.length < 3) {
      newErrors.username = 'Username must be at least 3 characters';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone number is required';
    } else if (!/^\+?[1-9]\d{9,14}$/.test(formData.phone.replace(/\s/g, ''))) {
      newErrors.phone = 'Must be a valid phone number (e.g., +919876543210)';
    }

    if (!formData.gender) {
      newErrors.gender = 'Please select a gender';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Must be a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Confirm password is required';
    } else if (formData.confirmPassword !== formData.password) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (otpSent && !formData.otp) {
      newErrors.otp = 'OTP is required';
    } else if (otpSent && !/^\d{6}$/.test(formData.otp)) {
      newErrors.otp = 'OTP must be 6 digits';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const formatPhoneNumber = (phone: string): string => {
    const cleaned = phone.replace(/\D/g, '');
    
    if (phone.startsWith('+')) {
      return phone.replace(/\s/g, '');
    }
    
    if (cleaned.length === 10) {
      return `+91${cleaned}`;
    }
    
    if (cleaned.length > 10) {
      return `+${cleaned}`;
    }
    
    return phone;
  };

  const handleSendOtp = async () => {
    if (errors.email || !formData.email.trim()) {
      setErrors(prev => ({ ...prev, email: 'Must be a valid email address' }));
      return;
    }

    if (errors.phone || !formData.phone.trim()) {
      setErrors(prev => ({ ...prev, phone: 'Phone number is required' }));
      return;
    }

    setIsSendingOtp(true);
    try {
      const apiUrl = `http://localhost:8000/api/send-otp`;
      const formattedPhone = formatPhoneNumber(formData.phone);
      
      const response = await axios.post(apiUrl, { 
        email: formData.email,
        phone: formattedPhone
      });
      
      if (response.data.success) {
        setOtpSent(true);
        setFormData(prev => ({ ...prev, phone: formattedPhone }));
        toast({
          title: "OTP Sent!",
          description: response.data.message || "Please check your phone/email for the verification code.",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to Send OTP",
        description: error.response?.data?.detail || "An unexpected error occurred.",
      });
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    try {
      const formattedData = {
        ...formData,
        phone: formatPhoneNumber(formData.phone)
      };
      
      const success = await signup(formattedData);
      if (success) {
        toast({
          title: "Account created!",
          description: "Welcome! You have been automatically signed in.",
        });
      }
    } catch (error: any) {
      let errorMessage = "An unexpected error occurred. Please try again.";
      let errorTitle = "Signup Failed";
      
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail.toLowerCase();
        
        if (detail.includes('email')) {
          errorMessage = "This email is already registered. Please use a different email or try logging in.";
          errorTitle = "Email Already Exists";
          setErrors(prev => ({ ...prev, email: 'Email already registered' }));
        } else if (detail.includes('username')) {
          errorMessage = "This username is already taken. Please choose a different username.";
          errorTitle = "Username Already Taken";
          setErrors(prev => ({ ...prev, username: 'Username already taken' }));
        } else if (detail.includes('phone')) {
          errorMessage = "This phone number is already registered. Please use a different phone number.";
          errorTitle = "Phone Already Registered";
          setErrors(prev => ({ ...prev, phone: 'Phone number already registered' }));
        } else if (detail.includes('otp')) {
          errorMessage = "Invalid or expired OTP. Please request a new OTP and try again.";
          errorTitle = "Invalid OTP";
          setErrors(prev => ({ ...prev, otp: 'Invalid or expired OTP' }));
        } else {
          errorMessage = error.response.data.detail;
        }
      }
      
      toast({
        variant: "destructive",
        title: errorTitle,
        description: errorMessage,
      });
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Header Section */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-3">
          Create your account
        </h1>
        <p className="text-base text-slate-600 dark:text-slate-400 font-normal">
          Join us today and get started in minutes
        </p>
      </div>

      {/* Main Form Card */}
      <div className="bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name Fields Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* First Name */}
            <div className="space-y-2.5">
              <Label 
                htmlFor="firstName" 
                className="text-sm font-semibold text-slate-700 dark:text-slate-300"
              >
                First Name
              </Label>
              <Input
                id="firstName"
                type="text"
                value={formData.firstName}
                onChange={(e) => handleInputChange('firstName', e.target.value)}
                placeholder="John"
                className={`h-11 px-4 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                  focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                  ${errors.firstName ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed
                  placeholder:text-slate-400 dark:placeholder:text-slate-500`}
                disabled={isLoading}
              />
              {errors.firstName && (
                <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                  <AlertCircle size={14} strokeWidth={2.5} />
                  {errors.firstName}
                </p>
              )}
            </div>

            {/* Last Name */}
            <div className="space-y-2.5">
              <Label 
                htmlFor="lastName" 
                className="text-sm font-semibold text-slate-700 dark:text-slate-300"
              >
                Last Name
              </Label>
              <Input
                id="lastName"
                type="text"
                value={formData.lastName}
                onChange={(e) => handleInputChange('lastName', e.target.value)}
                placeholder="Doe"
                className={`h-11 px-4 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                  focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                  ${errors.lastName ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed
                  placeholder:text-slate-400 dark:placeholder:text-slate-500`}
                disabled={isLoading}
              />
              {errors.lastName && (
                <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                  <AlertCircle size={14} strokeWidth={2.5} />
                  {errors.lastName}
                </p>
              )}
            </div>
          </div>

          {/* Username */}
          <div className="space-y-2.5">
            <Label 
              htmlFor="username" 
              className="text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              Username
            </Label>
            <Input
              id="username"
              type="text"
              value={formData.username}
              onChange={(e) => handleInputChange('username', e.target.value)}
              placeholder="johndoe"
              className={`h-11 px-4 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                ${errors.username ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                disabled:opacity-50 disabled:cursor-not-allowed
                placeholder:text-slate-400 dark:placeholder:text-slate-500`}
              disabled={isLoading}
            />
            {errors.username && (
              <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                <AlertCircle size={14} strokeWidth={2.5} />
                {errors.username}
              </p>
            )}
          </div>

          {/* Phone & Gender Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Phone */}
            <div className="space-y-2.5">
              <Label 
                htmlFor="phone" 
                className="text-sm font-semibold text-slate-700 dark:text-slate-300"
              >
                Phone Number
              </Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
                placeholder="+919876543210"
                className={`h-11 px-4 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                  focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                  ${errors.phone ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed
                  placeholder:text-slate-400 dark:placeholder:text-slate-500`}
                disabled={isLoading}
              />
              {errors.phone && (
                <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                  <AlertCircle size={14} strokeWidth={2.5} />
                  {errors.phone}
                </p>
              )}
            </div>

            {/* Gender */}
            <div className="space-y-2.5">
              <Label 
                htmlFor="gender" 
                className="text-sm font-semibold text-slate-700 dark:text-slate-300"
              >
                Gender
              </Label>
              <Select
                value={formData.gender}
                onValueChange={(value) => handleInputChange('gender', value)}
                disabled={isLoading}
              >
                <SelectTrigger 
                  className={`h-11 px-4 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                    focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                    ${errors.gender ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}`}
                >
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="Male" className="rounded-lg">Male</SelectItem>
                  <SelectItem value="Female" className="rounded-lg">Female</SelectItem>
                  <SelectItem value="Non-binary" className="rounded-lg">Non-binary</SelectItem>
                  <SelectItem value="Prefer not to say" className="rounded-lg">Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
              {errors.gender && (
                <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                  <AlertCircle size={14} strokeWidth={2.5} />
                  {errors.gender}
                </p>
              )}
            </div>
          </div>

          {/* Email with OTP */}
          <div className="space-y-2.5">
            <Label 
              htmlFor="email" 
              className="text-sm font-semibold text-slate-700 dark:text-slate-300"
            >
              Email Address
            </Label>
            <div className="relative">
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="john@example.com"
                className={`h-11 px-4 pr-24 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                  focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                  ${otpSent ? 'bg-slate-50 dark:bg-slate-900/50' : ''}
                  ${errors.email ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed
                  placeholder:text-slate-400 dark:placeholder:text-slate-500`}
                disabled={isLoading || otpSent}
              />
              {!otpSent ? (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 px-3 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-50 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all duration-200"
                  disabled={isSendingOtp || isLoading || !!errors.email || !!errors.phone}
                >
                  {isSendingOtp ? (
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />
                  ) : (
                    <>
                      <Mail size={16} strokeWidth={2.5} />
                      <span>Send OTP</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <Check size={16} strokeWidth={2.5} />
                  <span className="text-xs font-semibold">Verified</span>
                </div>
              )}
            </div>
            {errors.email && (
              <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                <AlertCircle size={14} strokeWidth={2.5} />
                {errors.email}
              </p>
            )}
          </div>

          {/* OTP Field */}
          {otpSent && (
            <div className="space-y-2.5 animate-in slide-in-from-top-2">
              <Label 
                htmlFor="otp" 
                className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2"
              >
                <Shield size={16} className="text-slate-600 dark:text-slate-400" strokeWidth={2.5} />
                Verification Code
              </Label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                value={formData.otp}
                onChange={(e) => handleInputChange('otp', e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                maxLength={6}
                className={`h-14 px-4 text-center text-2xl tracking-[0.5em] font-bold border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
                  focus:ring-2 focus:ring-slate-400/20 focus:border-slate-400 dark:focus:border-slate-500
                  ${errors.otp ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed
                  placeholder:text-slate-300 dark:placeholder:text-slate-600 placeholder:tracking-[0.5em]`}
                disabled={isLoading}
                autoFocus
              />
              {errors.otp && (
                <p className="text-sm text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2">
                  <AlertCircle size={14} strokeWidth={2.5} />
                  {errors.otp}
                </p>
              )}
            </div>
          )}

          {/* Password Fields Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Password */}
            <div className="space-y-2.5">
              <Label 
                htmlFor="password" 
                className="text-sm font-semibold text-slate-700 dark:text-slate-300"
              >
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder="Enter password"
                  className={`h-11 px-4 pr-12 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
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
                  <AlertCircle size={14} strokeWidth={2.5} />
                  {errors.password}
                </p>
              )}
            </div>

            {/* Confirm Password */}
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
                  placeholder="Confirm password"
                  className={`h-11 px-4 pr-12 text-base border-slate-300 dark:border-slate-600 rounded-xl transition-all duration-200
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
                  <AlertCircle size={14} strokeWidth={2.5} />
                  {errors.confirmPassword}
                </p>
              )}
            </div>
          </div>

          {/* Password Requirements Info */}
          <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">
              Password must be at least 8 characters long
            </p>
          </div>

          {/* Submit Button */}
          <Button 
            type="submit" 
            className="w-full h-12 text-base font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 rounded-xl shadow-lg shadow-slate-900/10 dark:shadow-slate-100/10 transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
            disabled={isLoading || !otpSent}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" strokeWidth={2.5} />
                <span>Creating Account...</span>
              </>
            ) : (
              <>
                <UserPlus className="w-5 h-5 mr-2" strokeWidth={2.5} />
                <span>Create Account</span>
              </>
            )}
          </Button>

          {/* Switch to Login */}
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-medium">
                Already have an account?
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onSwitchToLogin}
            className="w-full h-12 text-base font-semibold border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-400 dark:hover:border-slate-500 rounded-xl transition-all duration-200 active:scale-[0.98]"
            disabled={isLoading}
          >
            Sign In Instead
          </button>
        </form>
      </div>
    </div>
  );
};

export default SignupForm;
