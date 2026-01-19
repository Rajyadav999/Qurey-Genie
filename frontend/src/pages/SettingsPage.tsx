import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  User, Mail, Phone, Lock, Eye, EyeOff, Loader2, Save, ArrowLeft, Shield, X, AlertCircle, CheckCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_BASE = 'http://localhost:8000/api';

const SettingsPage = () => {
  const { user, updateUserProfile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [profileData, setProfileData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    username: user?.username || '',
    email: user?.email || '',
    phone: user?.phone || '',
    gender: user?.gender || ''
  });

  const [originalEmail, setOriginalEmail] = useState(user?.email || '');
  const [isEmailVerified, setIsEmailVerified] = useState(false); // Track if new email is verified
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [isSendingOTP, setIsSendingOTP] = useState(false);
  const [isVerifyingOTP, setIsVerifyingOTP] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0);

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>('profile');

  useEffect(() => {
    if (otpTimer > 0) {
      const interval = setInterval(() => setOtpTimer(prev => prev - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [otpTimer]);

  const hasEmailChanged = () => profileData.email !== originalEmail;

  const validateProfileForm = () => {
    const errors: Record<string, string> = {};
    if (!profileData.firstName.trim()) errors.firstName = 'First name is required';
    else if (!/^[A-Za-z]+$/.test(profileData.firstName)) errors.firstName = 'Only letters allowed';
    
    if (!profileData.lastName.trim()) errors.lastName = 'Last name is required';
    else if (!/^[A-Za-z]+$/.test(profileData.lastName)) errors.lastName = 'Only letters allowed';
    
    if (!profileData.username.trim()) errors.username = 'Username is required';
    else if (!/^[A-Za-z0-9_]+$/.test(profileData.username)) errors.username = 'Only letters, numbers, underscores';
    
    if (!profileData.email.trim()) errors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileData.email)) errors.email = 'Invalid email';
    
    if (!profileData.phone.trim()) errors.phone = 'Phone is required';
    else if (!/^\+?[1-9]\d{9,14}$/.test(profileData.phone.replace(/\s/g, ''))) errors.phone = 'Invalid phone';
    
    if (!profileData.gender) errors.gender = 'Gender is required';
    
    setProfileErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validatePasswordForm = () => {
    const errors: Record<string, string> = {};
    if (!passwordData.currentPassword) errors.currentPassword = 'Current password required';
    if (!passwordData.newPassword) errors.newPassword = 'New password required';
    else if (passwordData.newPassword.length < 8) errors.newPassword = 'Min 8 characters';
    if (!passwordData.confirmPassword) errors.confirmPassword = 'Confirm password';
    else if (passwordData.newPassword !== passwordData.confirmPassword) errors.confirmPassword = 'Passwords don\'t match';
    if (passwordData.currentPassword === passwordData.newPassword) errors.newPassword = 'New password must differ';
    
    setPasswordErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleProfileChange = (field: string, value: string) => {
    setProfileData(prev => ({ ...prev, [field]: value }));
    if (profileErrors[field]) setProfileErrors(prev => ({ ...prev, [field]: '' }));
    
    // Reset email verification status if email is changed again
    if (field === 'email' && value !== originalEmail) {
      setIsEmailVerified(false);
    }
  };

  const handlePasswordChange = (field: string, value: string) => {
    setPasswordData(prev => ({ ...prev, [field]: value }));
    if (passwordErrors[field]) setPasswordErrors(prev => ({ ...prev, [field]: '' }));
  };

  // Handle verify icon click - open OTP modal
  const handleVerifyIconClick = async () => {
    // Validate email first
    if (!profileData.email.trim()) {
      setProfileErrors(prev => ({ ...prev, email: 'Email is required' }));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileData.email)) {
      setProfileErrors(prev => ({ ...prev, email: 'Invalid email format' }));
      return;
    }

    await handleSendEmailOTP();
  };

  // Send OTP for email change
  const handleSendEmailOTP = async () => {
    setIsSendingOTP(true);
    try {
      await axios.post(`${API_BASE}/send-email-change-otp`, {
        userId: user?.id,
        newEmail: profileData.email
      });
      
      setShowOTPModal(true);
      setOtpTimer(300); // 5 minutes
      setOtp('');
      setOtpError('');
      
      toast({
        title: "OTP Sent!",
        description: `Verification code sent to ${profileData.email}`,
      });
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || "Failed to send OTP";
      toast({
        variant: "destructive",
        title: "Failed",
        description: errorMsg,
      });
      
      // If email is already in use, show error
      if (errorMsg.toLowerCase().includes('already in use')) {
        setProfileErrors(prev => ({ ...prev, email: 'Email already in use' }));
      }
    } finally {
      setIsSendingOTP(false);
    }
  };

  // Verify OTP and mark email as verified
  const handleVerifyOTP = async () => {
    if (otp.length !== 6) {
      setOtpError('OTP must be 6 digits');
      return;
    }

    setIsVerifyingOTP(true);
    try {
      const response = await axios.put(`${API_BASE}/update-email`, {
        userId: user?.id,
        newEmail: profileData.email,
        otp: otp
      });

      if (response.data.success) {
        // ✅ Mark email as verified
        setIsEmailVerified(true);
        setOriginalEmail(profileData.email);
        setShowOTPModal(false);
        
        // ✅ Update user context with new email
        await updateUserProfile({ ...user, email: profileData.email });
        
        toast({
          title: "Email Verified!",
          description: "Your email has been verified successfully. You can now save other changes.",
        });
      }
    } catch (error: any) {
      setOtpError(error.response?.data?.detail || "Invalid OTP");
    } finally {
      setIsVerifyingOTP(false);
    }
  };

  // Main update handler - only updates non-email fields
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateProfileForm()) return;

    // ✅ Check if email changed but not verified
    if (hasEmailChanged() && !isEmailVerified) {
      toast({
        variant: "destructive",
        title: "Email Not Verified",
        description: "Please verify your new email address first by clicking the verify icon.",
      });
      return;
    }

    setIsUpdatingProfile(true);
    try {
      const response = await axios.put(`${API_BASE}/update-profile`, {
        userId: user?.id,
        ...profileData
      });

      if (response.data.success) {
        await updateUserProfile(response.data.user);
        
        toast({
          title: "Profile Updated!",
          description: "Your profile has been updated successfully",
        });
      }
    } catch (error: any) {
      const detail = error.response?.data?.detail?.toLowerCase() || '';
      if (detail.includes('username')) {
        setProfileErrors(prev => ({ ...prev, username: 'Username taken' }));
      } else if (detail.includes('phone')) {
        setProfileErrors(prev => ({ ...prev, phone: 'Phone registered' }));
      } else if (detail.includes('email')) {
        setProfileErrors(prev => ({ ...prev, email: 'Email already in use' }));
      }
      
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error.response?.data?.detail || "Failed to update",
      });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatePasswordForm()) return;

    setIsChangingPassword(true);
    try {
      await axios.post(`${API_BASE}/change-password`, {
        userId: user?.id,
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword
      });

      toast({ title: "Password Changed!", description: "Password updated successfully" });
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      const detail = error.response?.data?.detail?.toLowerCase() || '';
      if (detail.includes('incorrect')) {
        setPasswordErrors(prev => ({ ...prev, currentPassword: 'Incorrect password' }));
      }
      toast({ variant: "destructive", title: "Failed", description: error.response?.data?.detail });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4">
            <ArrowLeft size={20} />
            <span>Back to Dashboard</span>
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Account Settings</h1>
          <p className="text-gray-600 mt-1">Manage your account settings</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-2 px-6 py-4 font-medium ${
                activeTab === 'profile' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'
              }`}
            >
              <User size={20} />
              Profile
            </button>
            <button
              onClick={() => setActiveTab('password')}
              className={`flex items-center gap-2 px-6 py-4 font-medium ${
                activeTab === 'password' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-600'
              }`}
            >
              <Shield size={20} />
              Password
            </button>
          </div>

          {activeTab === 'profile' && (
            <form onSubmit={handleUpdateProfile} className="p-6 space-y-6">
              {hasEmailChanged() && !isEmailVerified && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                  <AlertCircle className="text-amber-600 mt-0.5" size={20} />
                  <div>
                    <p className="text-sm font-medium text-amber-900">Email Verification Required</p>
                    <p className="text-sm text-amber-700 mt-1">
                      Click the verify icon next to your email to verify <strong>{profileData.email}</strong>
                    </p>
                  </div>
                </div>
              )}

              {isEmailVerified && hasEmailChanged() && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                  <CheckCircle className="text-green-600 mt-0.5" size={20} />
                  <div>
                    <p className="text-sm font-medium text-green-900">Email Verified!</p>
                    <p className="text-sm text-green-700 mt-1">
                      <strong>{profileData.email}</strong> has been verified. Click Save Changes to update your profile.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>First Name</Label>
                  <Input
                    value={profileData.firstName}
                    onChange={(e) => handleProfileChange('firstName', e.target.value)}
                    className={profileErrors.firstName ? 'border-red-300' : ''}
                  />
                  {profileErrors.firstName && <p className="text-xs text-red-500">{profileErrors.firstName}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Last Name</Label>
                  <Input
                    value={profileData.lastName}
                    onChange={(e) => handleProfileChange('lastName', e.target.value)}
                    className={profileErrors.lastName ? 'border-red-300' : ''}
                  />
                  {profileErrors.lastName && <p className="text-xs text-red-500">{profileErrors.lastName}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  value={profileData.username}
                  onChange={(e) => handleProfileChange('username', e.target.value)}
                  className={profileErrors.username ? 'border-red-300' : ''}
                />
                {profileErrors.username && <p className="text-xs text-red-500">{profileErrors.username}</p>}
              </div>

              {/* ✅ EMAIL FIELD WITH VERIFY ICON */}
              <div className="space-y-2">
                <Label>
                  Email 
                  {hasEmailChanged() && !isEmailVerified && (
                    <span className="text-amber-600 text-xs ml-2">(Requires verification)</span>
                  )}
                  {isEmailVerified && (
                    <span className="text-green-600 text-xs ml-2">(Verified ✓)</span>
                  )}
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <Input
                    type="email"
                    value={profileData.email}
                    onChange={(e) => handleProfileChange('email', e.target.value)}
                    className={`pl-11 ${
                      hasEmailChanged() && !isEmailVerified ? 'pr-12' : 'pr-4'
                    } ${profileErrors.email ? 'border-red-300' : hasEmailChanged() && !isEmailVerified ? 'border-amber-300' : isEmailVerified ? 'border-green-300' : ''}`}
                  />
                  
                  {/* ✅ VERIFY ICON - Only show if email changed and not verified */}
                  {hasEmailChanged() && !isEmailVerified && (
                    <button
                      type="button"
                      onClick={handleVerifyIconClick}
                      disabled={isSendingOTP}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                      title="Verify email"
                    >
                      {isSendingOTP ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Mail className="w-5 h-5" />
                      )}
                    </button>
                  )}

                  {/* ✅ CHECK ICON - Show if email is verified */}
                  {isEmailVerified && hasEmailChanged() && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600" size={20} />
                  )}
                </div>
                {profileErrors.email && <p className="text-xs text-red-500">{profileErrors.email}</p>}
              </div>

              <div className="space-y-2">
                <Label>Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <Input
                    type="tel"
                    value={profileData.phone}
                    onChange={(e) => handleProfileChange('phone', e.target.value)}
                    className={`pl-11 ${profileErrors.phone ? 'border-red-300' : ''}`}
                  />
                </div>
                {profileErrors.phone && <p className="text-xs text-red-500">{profileErrors.phone}</p>}
              </div>

              <div className="space-y-2">
                <Label>Gender</Label>
                <Select value={profileData.gender} onValueChange={(value) => handleProfileChange('gender', value)}>
                  <SelectTrigger className={profileErrors.gender ? 'border-red-300' : ''}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Non-binary">Non-binary</SelectItem>
                    <SelectItem value="Prefer not to say">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
                {profileErrors.gender && <p className="text-xs text-red-500">{profileErrors.gender}</p>}
              </div>

              <div className="flex justify-end pt-4">
                <Button
                  type="submit"
                  className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-8"
                  disabled={isUpdatingProfile}
                >
                  {isUpdatingProfile ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}

          {activeTab === 'password' && (
            <form onSubmit={handleChangePassword} className="p-6 space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800"><strong>Requirement:</strong> Min 8 characters</p>
              </div>

              {['currentPassword', 'newPassword', 'confirmPassword'].map((field, idx) => (
                <div key={field} className="space-y-2">
                  <Label>{field === 'currentPassword' ? 'Current' : field === 'newPassword' ? 'New' : 'Confirm'} Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <Input
                      type={[showCurrentPassword, showNewPassword, showConfirmPassword][idx] ? 'text' : 'password'}
                      value={passwordData[field as keyof typeof passwordData]}
                      onChange={(e) => handlePasswordChange(field, e.target.value)}
                      className={`pl-11 pr-12 ${passwordErrors[field] ? 'border-red-300' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (idx === 0) setShowCurrentPassword(!showCurrentPassword);
                        if (idx === 1) setShowNewPassword(!showNewPassword);
                        if (idx === 2) setShowConfirmPassword(!showConfirmPassword);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    >
                      {[showCurrentPassword, showNewPassword, showConfirmPassword][idx] ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                  {passwordErrors[field] && <p className="text-xs text-red-500">{passwordErrors[field]}</p>}
                </div>
              ))}

              <div className="flex justify-end pt-4">
                <Button
                  type="submit"
                  className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-8"
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Changing...
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 mr-2" />
                      Change Password
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* OTP VERIFICATION MODAL */}
      {showOTPModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 rounded-t-xl flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Verify Email</h2>
              <button 
                onClick={() => {
                  setShowOTPModal(false);
                  setOtp('');
                  setOtpError('');
                }} 
                className="text-white hover:bg-white/20 p-1 rounded-lg"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-gray-600 text-sm">Code sent to:</p>
              <p className="text-indigo-600 font-semibold text-center bg-indigo-50 py-2 px-4 rounded-lg">{profileData.email}</p>

              <div className="space-y-2">
                <Label>Enter 6-Digit Code</Label>
                <Input
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/[^0-9]/g, ''));
                    setOtpError('');
                  }}
                  placeholder="000000"
                  className={`h-12 text-center text-2xl font-bold tracking-widest ${otpError ? 'border-red-300' : ''}`}
                  autoFocus
                />
                {otpError && <p className="text-xs text-red-500 text-center">{otpError}</p>}
              </div>

              {otpTimer > 0 && (
                <p className="text-sm text-gray-600 text-center">
                  Expires in <span className="font-semibold text-indigo-600">{formatTime(otpTimer)}</span>
                </p>
              )}

              <button
                onClick={handleSendEmailOTP}
                disabled={otpTimer > 0 || isSendingOTP}
                className={`text-sm w-full ${otpTimer > 0 ? 'text-gray-400 cursor-not-allowed' : 'text-indigo-600 hover:text-indigo-700'}`}
              >
                {isSendingOTP ? 'Sending...' : "Didn't receive? Resend"}
              </button>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowOTPModal(false);
                    setOtp('');
                    setOtpError('');
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleVerifyOTP}
                  className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600"
                  disabled={isVerifyingOTP || otp.length !== 6}
                >
                  {isVerifyingOTP ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;