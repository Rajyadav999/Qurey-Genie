import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, EyeOff, Loader2, Mail, UserPlus, Check, Sparkles } from 'lucide-react';
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
    <div className="w-full max-w-md mx-auto">
      {/* Decorative background elements */}
      <div className="relative">
        <div className="absolute -top-20 -left-20 w-40 h-40 bg-purple-200 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse"></div>
        <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-indigo-200 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse" style={{ animationDelay: '1s' }}></div>
      </div>

      {/* Main card */}
      <div className="relative bg-white/90 backdrop-blur-lg rounded-3xl shadow-2xl border border-gray-100 p-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-2xl mb-4 shadow-xl transform hover:scale-105 transition-transform">
            <UserPlus className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">
            Create Account
          </h2>
          <p className="text-gray-600">Join thousands using Query Genie</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName" className="text-sm font-medium text-gray-700">
                First Name
              </Label>
              <div className="relative">
                <Input
                  id="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  placeholder="John"
                  className={`h-11 px-4 rounded-xl border-2 transition-all duration-200 ${
                    errors.firstName 
                      ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100' 
                      : 'border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
                  }`}
                  disabled={isLoading}
                />
              </div>
              {errors.firstName && (
                <p className="text-xs text-red-500 flex items-center gap-1 animate-in slide-in-from-top-1">
                  <span>⚠️</span> {errors.firstName}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName" className="text-sm font-medium text-gray-700">
                Last Name
              </Label>
              <div className="relative">
                <Input
                  id="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  placeholder="Doe"
                  className={`h-11 px-4 rounded-xl border-2 transition-all duration-200 ${
                    errors.lastName 
                      ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100' 
                      : 'border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
                  }`}
                  disabled={isLoading}
                />
              </div>
              {errors.lastName && (
                <p className="text-xs text-red-500 flex items-center gap-1 animate-in slide-in-from-top-1">
                  <span>⚠️</span> {errors.lastName}
                </p>
              )}
            </div>
          </div>

          {/* Username */}
          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-medium text-gray-700">
              Username
            </Label>
            <Input
              id="username"
              type="text"
              value={formData.username}
              onChange={(e) => handleInputChange('username', e.target.value)}
              placeholder="johndoe"
              className={`h-11 px-4 rounded-xl border-2 transition-all duration-200 ${
                errors.username 
                  ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100' 
                  : 'border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
              }`}
              disabled={isLoading}
            />
            {errors.username && (
              <p className="text-xs text-red-500 flex items-center gap-1 animate-in slide-in-from-top-1">
                <span>⚠️</span> {errors.username}
              </p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-sm font-medium text-gray-700">
              Phone Number
            </Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              placeholder="+919876543210 or 9876543210"
              className={`h-11 px-4 rounded-xl border-2 transition-all duration-200 ${
                errors.phone 
                  ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100' 
                  : 'border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
              }`}
              disabled={isLoading}
            />
            <p className="text-xs text-gray-500">Format: +[country code][number]</p>
            {errors.phone && (
              <p className="text-xs text-red-500 flex items-center gap-1 animate-in slide-in-from-top-1">
                <span>⚠️</span> {errors.phone}
              </p>
            )}
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <Label htmlFor="gender" className="text-sm font-medium text-gray-700">
              Gender
            </Label>
            <Select
              value={formData.gender}
              onValueChange={(value) => handleInputChange('gender', value)}
              disabled={isLoading}
            >
              <SelectTrigger className={`h-11 px-4 rounded-xl border-2 transition-all duration-200 ${
                errors.gender 
                  ? 'border-red-300 focus:border-red-500' 
                  : 'border-gray-200 focus:border-indigo-500'
              }`}>
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Male">Male</SelectItem>
                <SelectItem value="Female">Female</SelectItem>
                <SelectItem value="Non-binary">Non-binary</SelectItem>
                <SelectItem value="Prefer not to say">Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
            {errors.gender && (
              <p className="text-xs text-red-500 flex items-center gap-1 animate-in slide-in-from-top-1">
                <span>⚠️</span> {errors.gender}
              </p>
            )}
          </div>

          {/* Email with OTP */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium text-gray-700">
              Email Address
            </Label>
            <div className="relative">
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="john@example.com"
                className={`h-11 px-4 pr-12 rounded-xl border-2 transition-all duration-200 ${
                  otpSent ? 'bg-gray-50' : ''
                } ${
                  errors.email 
                    ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100' 
                    : 'border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
                }`}
                disabled={isLoading || otpSent}
              />
              {!otpSent && (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-600 hover:text-indigo-700 disabled:opacity-50 p-2 hover:bg-indigo-50 rounded-lg transition-all"
                  disabled={isSendingOtp || isLoading || !!errors.email || !!errors.phone}
                >
                  {isSendingOtp ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Mail size={20} />
                  )}
                </button>
              )}
              {otpSent && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-green-600 bg-green-50 px-2 py-1 rounded-lg">
                  <Check size={16} />
                  <span className="text-xs font-medium">Sent</span>
                </div>
              )}
            </div>
            {errors.email && (
              <p className="text-xs text-red-500 flex items-center gap-1 animate-in slide-in-from-top-1">
                <span>⚠️</span> {errors.email}
              </p>
            )}
          </div>

          {/* OTP Field */}
          {otpSent && (
            <div className="space-y-2 animate-in slide-in-from-top-2">
              <Label htmlFor="otp" className="text-sm font-medium text-gray-700 flex items-center gap-2">
                Verification Code
                <Sparkles className="w-4 h-4 text-indigo-500" />
              </Label>
              <Input
                id="otp"
                type="text"
                value={formData.otp}
                onChange={(e) => handleInputChange('otp', e.target.value)}
                placeholder="• • • • • •"
                maxLength={6}
                className={`h-12 px-4 rounded-xl border-2 text-center text-xl font-semibold tracking-[0.5em] transition-all duration-200 ${
                  errors.otp 
                    ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100' 
                    : 'border-indigo-300 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 bg-indigo-50/30'
                }`}
                disabled={isLoading}
              />
              {errors.otp && (
                <p className="text-xs text-red-500 flex items-center gap-1 animate-in slide-in-from-top-1">
                  <span>⚠️</span> {errors.otp}
                </p>
              )}
            </div>
          )}

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium text-gray-700">
              Password
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => handleInputChange('password', e.target.value)}
                placeholder="Enter password"
                className={`h-11 px-4 pr-12 rounded-xl border-2 transition-all duration-200 ${
                  errors.password 
                    ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100' 
                    : 'border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
                }`}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded transition-all"
                disabled={isLoading}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-red-500 flex items-center gap-1 animate-in slide-in-from-top-1">
                <span>⚠️</span> {errors.password}
              </p>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
              Confirm Password
            </Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                placeholder="Confirm password"
                className={`h-11 px-4 pr-12 rounded-xl border-2 transition-all duration-200 ${
                  errors.confirmPassword 
                    ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100' 
                    : 'border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
                }`}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded transition-all"
                disabled={isLoading}
              >
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-xs text-red-500 flex items-center gap-1 animate-in slide-in-from-top-1">
                <span>⚠️</span> {errors.confirmPassword}
              </p>
            )}
          </div>

          {/* Submit Button */}
          <Button 
            type="submit" 
            className="w-full h-12 mt-6 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-700 hover:via-purple-700 hover:to-pink-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            disabled={isLoading || !otpSent}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Creating Account...
              </>
            ) : (
              <>
                <UserPlus className="w-5 h-5 mr-2" />
                Create Account
              </>
            )}
          </Button>

          {/* Switch to Login */}
          <div className="text-center pt-4">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="text-indigo-600 hover:text-indigo-700 font-semibold transition-colors hover:underline"
                disabled={isLoading}
              >
                Sign In
              </button>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SignupForm;